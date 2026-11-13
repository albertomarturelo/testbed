import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { ok } from "../errors.js";
import { CONFIG_FILE } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { ExactVersion } from "../schema/index.js";
import { CASEFILE_PACKAGE, WEB_PACKAGE } from "./extensions.js";
import { defineOperation } from "./operation.js";
import { writeIfAbsent } from "./write-if-absent.js";

/** Where an agent looks for skills; the human picks any of them, or none. */
export const SkillTarget = z.enum([".claude/skills", ".agents/skills"]);

/** A file of the skills bundle, relative to the bundle root: `casefile-setup/SKILL.md`. */
const SkillFile = z.strictObject({
  path: z
    .string()
    .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$)).+$/, "a relative path without . or .. segments"),
  text: z.string(),
});

const InitInput = z.strictObject({
  /** The casefile version running `init`; the host knows it, core does not look it up. */
  casefileVersion: ExactVersion.meta({ host: "version" }),
  /** The skills shipped in the published package, read by the host (`readSkillBundle`). */
  skills: z.array(SkillFile).default([]).meta({ host: "skills" }),
  /** Where to copy them; empty means only offer them. */
  skillsInto: z.array(SkillTarget).default([]),
});

const InitOutput = z.strictObject({
  /** Workspace-relative files written by this run. */
  created: z.array(z.string()),
  /** Files that already existed and were left untouched. */
  kept: z.array(z.string()),
  /**
   * Skill names in the bundle the host offers to copy, when `skillsInto` was
   * empty: every one, or, where an agent already reads casefile's skills, the
   * ones the new version adds there.
   */
  skillsOffered: z.array(z.string()),
  /**
   * Skills kept with a text that differs from the shipped one, as
   * `<target>/<name>`: an older version, or edited by hand. Never overwritten;
   * `next` says how to replace them on purpose.
   */
  stale: z.array(z.string()),
  /** What the human does next (ADR cli-generic-host): copy or refresh skills, the next skill to run, signing. */
  next: z.array(z.string()),
});

const CONFIG_TEXT = `# casefile workspace: run \`casefile spec setup\`.
# Projects are added by the agent with \`casefile project add <name> --path <path>\`.
version: 1
projects: []
`;

const TOOLCHAIN_GITIGNORE = "node_modules/\n";

const SETUP =
  "Run /casefile-setup in your agent: it reads `casefile spec setup`, registers each project and loops on `casefile validate --json` until it passes.";

/** Always advised after `init` (ADR git-is-identity). */
const SIGN =
  "Sign your commits with SSH so every change to a case has a verifiable author: git config gpg.format ssh && git config user.signingkey ~/.ssh/id_ed25519.pub && git config commit.gpgsign true";

function toolchainPackage(version: string): string {
  const pkg = {
    private: true,
    description: "casefile toolchain of this workspace; install with npm --prefix .casefile",
    // The viewer is installed by default, at the CLI's version (ADR casefile-ui-command §2).
    dependencies: { [CASEFILE_PACKAGE]: version, [WEB_PACKAGE]: version },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * `casefile init` (ADR agent-driven-setup, casefile-toolchain-dir): the human's
 * one setup command. Writes `casefile.yaml` and `.casefile/`, and copies the
 * shipped skills only where the input says. Idempotent; never overwrites; never
 * writes under `context/` nor the product's `package.json` — `writes` enforces it.
 */
export const initOperation = defineOperation({
  name: "init",
  input: InitInput,
  output: InitOutput,
  actor: ["human"],
  writes: [
    CONFIG_FILE,
    ".casefile/package.json",
    ".casefile/.gitignore",
    ...SkillTarget.options.map((target) => `${target}/**`),
  ],
  spec: "specs/init.md",
  root: "cwd",
  async run(input, context) {
    const created: string[] = [];
    const kept: string[] = [];
    const write = async (path: string, text: string) => {
      ((await writeIfAbsent(context, path, text)) ? created : kept).push(path);
    };

    await write(CONFIG_FILE, CONFIG_TEXT);
    await write(".casefile/package.json", toolchainPackage(input.casefileVersion));
    await write(".casefile/.gitignore", TOOLCHAIN_GITIGNORE);
    for (const target of new Set(input.skillsInto)) {
      for (const file of input.skills) await write(`${target}/${file.path}`, file.text);
    }

    // A skill is a top-level directory of the bundle; loose files are not offered.
    const bundle = new Map<string, { path: string; text: string }[]>();
    for (const file of input.skills) {
      const name = /^([^/]+)\//.exec(file.path)?.[1];
      if (name !== undefined) bundle.set(name, [...(bundle.get(name) ?? []), file]);
    }
    const names = [...bundle.keys()].sort();

    // Where an agent reads casefile's skills: the chosen targets, else any that has one already.
    const targets: string[] = [];
    for (const target of SkillTarget.options) {
      const chosen = input.skillsInto.includes(target);
      const has = async () => {
        for (const name of names) if (await context.exists(`${target}/${name}`)) return true;
        return false;
      };
      if (chosen || (input.skillsInto.length === 0 && (await has()))) targets.push(target);
    }

    // A kept skill whose shipped files read differently: older, or edited by hand.
    const stale: string[] = [];
    for (const target of targets) {
      for (const name of names) {
        for (const file of bundle.get(name) ?? []) {
          const there = await context.readText(`${target}/${file.path}`);
          if (there !== null && there !== file.text) {
            stale.push(`${target}/${name}`);
            break;
          }
        }
      }
    }

    let skillsOffered: string[] = [];
    let offerInto = ".claude/skills (or .agents/skills)";
    if (input.skillsInto.length === 0) {
      if (targets.length === 0) skillsOffered = names;
      else {
        const missing = new Set<string>();
        for (const target of targets) {
          for (const name of names) {
            if (!(await context.exists(`${target}/${name}`))) missing.add(name);
          }
        }
        skillsOffered = [...missing].sort();
        offerInto = targets.join(" --skills-into ");
      }
    }

    const next: string[] = [];
    if (skillsOffered.length > 0) {
      next.push(
        targets.length === 0
          ? `Copy the shipped skills (${skillsOffered.join(", ")}) where your agent reads them: casefile init --skills-into ${offerInto}.`
          : `This version adds skills (${skillsOffered.join(", ")}): casefile init --skills-into ${offerInto}.`,
      );
    }
    if (stale.length > 0) {
      const into = [...new Set(stale.map((s) => s.slice(0, s.lastIndexOf("/"))))];
      next.push(
        `Kept skills differ from this version's (${stale.join(", ")}): init never overwrites them. If you did not edit them, replace them: rm -rf ${stale.join(" ")} && casefile init${into.map((t) => ` --skills-into ${t}`).join("")}`,
      );
    }
    next.push(...(await nextSkill(context.root)), SIGN);
    return ok({ created, kept, skillsOffered, stale, next });
  },
});

/**
 * The skill to run next for the workspace as it is: `/casefile-setup` while it
 * has no projects, `/qa-bootstrap <project>` for each project without cases,
 * else the skills that keep cases current.
 */
async function nextSkill(root: string): Promise<string[]> {
  const workspace = await loadWorkspace(root);
  const broken = ["Run casefile validate: casefile cannot load this workspace as it is."];
  if (workspace.config === null) return workspace.errors.length > 0 ? broken : [SETUP];
  if (workspace.config.projects.length === 0) return [SETUP];
  if (workspace.projects.length === 0) return broken;
  const empty = workspace.projects.filter((p) => p.cases.length === 0).map((p) => p.name);
  if (empty.length > 0) {
    return empty.map(
      (name) =>
        `Run /qa-bootstrap ${name} in your agent: it proposes the project's feature tree and first draft cases from its code.`,
    );
  }
  return [
    "Your projects have cases: run /qa-review in your agent to change, approve or retire them, and /qa-cover for a feature that has none.",
  ];
}

/**
 * Filesystem adapter for hosts: every file under the bundled skills directory,
 * as `init`'s `skills` input. Sorted; `[]` when the directory does not exist.
 */
export async function readSkillBundle(dir: string): Promise<z.infer<typeof SkillFile>[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      path: relative(dir, file).split(sep).join("/"),
      text: await readFile(file, "utf8"),
    })),
  );
}
