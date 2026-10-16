import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { ok } from "../errors.js";
import { CONFIG_FILE } from "../load/paths.js";
import { ExactVersion } from "../schema/index.js";
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
  casefileVersion: ExactVersion,
  /** The skills shipped in the published package, read by the host (`readSkillBundle`). */
  skills: z.array(SkillFile).default([]),
  /** Where to copy them; empty means only offer them. */
  skillsInto: z.array(SkillTarget).default([]),
});

const InitOutput = z.strictObject({
  /** Workspace-relative files written by this run. */
  created: z.array(z.string()),
  /** Files that already existed and were left untouched. */
  kept: z.array(z.string()),
  /** Skill names in the bundle, for the host to offer when `skillsInto` was empty. */
  skillsOffered: z.array(z.string()),
});

const CONFIG_TEXT = `# casefile workspace: run \`casefile spec setup\`.
# Projects are added by the agent with \`casefile project add <name> <path>\`.
version: 1
projects: []
`;

const TOOLCHAIN_GITIGNORE = "node_modules/\n";

function toolchainPackage(version: string): string {
  const pkg = {
    private: true,
    description: "casefile toolchain of this workspace; install with npm --prefix .casefile",
    dependencies: { casefile: version },
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
    const names = [
      ...new Set(input.skills.flatMap((file) => /^([^/]+)\//.exec(file.path)?.slice(1) ?? [])),
    ];
    return ok({
      created,
      kept,
      skillsOffered: input.skillsInto.length === 0 ? names.sort() : [],
    });
  },
});

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
