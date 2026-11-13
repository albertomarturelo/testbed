import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { DEMO_ROOT } from "../demo.fixture.js";
import type { Result } from "../errors.js";
import { parseConfigFile } from "../load/parse.js";
import { builtinOperations } from "./builtins.js";
import { type initOperation, readSkillBundle } from "./init.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-init-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};
const read = (path: string) => readFile(join(root, path), "utf8");

const registry = createRegistry();
for (const operation of builtinOperations) registry.register(operation);
const init = (input: Record<string, unknown>, actor: Actor = "human") =>
  registry.invoke("init", { casefileVersion: "0.4.1", ...input }, { root, actor }) as Promise<
    Result<z.infer<typeof initOperation.output>>
  >;

const SKILLS = [
  { path: "casefile-setup/SKILL.md", text: "# setup\n" },
  { path: "qa-bootstrap/SKILL.md", text: "# bootstrap\n" },
];

describe("init", () => {
  it("writes casefile.yaml and .casefile/ in an empty repo", async () => {
    const result = await init({});
    expect(result).toEqual({
      ok: true,
      value: {
        created: ["casefile.yaml", ".casefile/package.json", ".casefile/.gitignore"],
        kept: [],
        skillsOffered: [],
        stale: [],
        next: [
          expect.stringContaining("/casefile-setup"),
          expect.stringContaining("gpg.format ssh"),
        ],
      },
    });
    const config = parseConfigFile("casefile.yaml", await read("casefile.yaml"));
    expect(config).toEqual({ ok: true, value: { version: 1, projects: [] } });
    expect(JSON.parse(await read(".casefile/package.json")).dependencies).toEqual({
      "@casefile/cli": "0.4.1",
      "@casefile/web": "0.4.1",
    });
    expect(await read(".casefile/.gitignore")).toBe("node_modules/\n");
  });

  it("is idempotent and never overwrites", async () => {
    await put("casefile.yaml", "version: 1\nprojects: [] # mine\n");
    await put(".casefile/package.json", '{"dependencies":{"@casefile/cli":"0.1.0"}}');
    const result = await init({});
    expect(result.ok && result.value.created).toEqual([".casefile/.gitignore"]);
    expect(await read("casefile.yaml")).toBe("version: 1\nprojects: [] # mine\n");
    expect(await read(".casefile/package.json")).toContain('"0.1.0"');

    const again = await init({});
    expect(again.ok && again.value).toEqual({
      created: [],
      kept: ["casefile.yaml", ".casefile/package.json", ".casefile/.gitignore"],
      skillsOffered: [],
      stale: [],
      next: expect.any(Array),
    });
  });

  it("leaves the product's package.json and context/ alone", async () => {
    await put("package.json", '{"name":"product"}');
    await init({ skills: SKILLS, skillsInto: [".claude/skills"] });
    expect(await read("package.json")).toBe('{"name":"product"}');
    await expect(read("context/tests/_common.yaml")).rejects.toThrow();
  });

  it("only offers the skills when no target is chosen", async () => {
    const result = await init({ skills: [...SKILLS, { path: "README.md", text: "# skills\n" }] });
    expect(result.ok && result.value.skillsOffered).toEqual(["casefile-setup", "qa-bootstrap"]);
    // Offered skills come first in the advice, with the command that copies them.
    expect(result.ok && result.value.next[0]).toContain(
      "casefile init --skills-into .claude/skills",
    );
    expect(result.ok && result.value.next).toHaveLength(3);
    await expect(read(".claude/skills/casefile-setup/SKILL.md")).rejects.toThrow();
    await expect(read(".agents/skills/casefile-setup/SKILL.md")).rejects.toThrow();
  });

  it("copies the skills into each chosen target without overwriting", async () => {
    await put(".agents/skills/qa-bootstrap/SKILL.md", "# edited\n");
    const result = await init({ skills: SKILLS, skillsInto: [".claude/skills", ".agents/skills"] });
    expect(result.ok && result.value.created).toEqual([
      "casefile.yaml",
      ".casefile/package.json",
      ".casefile/.gitignore",
      ".claude/skills/casefile-setup/SKILL.md",
      ".claude/skills/qa-bootstrap/SKILL.md",
      ".agents/skills/casefile-setup/SKILL.md",
    ]);
    expect(result.ok && result.value.kept).toEqual([".agents/skills/qa-bootstrap/SKILL.md"]);
    // Kept, and said: it differs from the shipped text (#152).
    expect(result.ok && result.value.stale).toEqual([".agents/skills/qa-bootstrap"]);
    expect(await read(".agents/skills/qa-bootstrap/SKILL.md")).toBe("# edited\n");
    expect(await read(".claude/skills/casefile-setup/SKILL.md")).toBe("# setup\n");
  });

  it("rejects ranges, unknown targets and skill paths that climb out", async () => {
    const codes = async (input: Record<string, unknown>) => {
      const result = await init(input);
      return result.ok ? [] : result.errors.map((e) => [e.code, e.field]);
    };
    expect(await codes({ casefileVersion: "^0.4.1" })).toEqual([
      ["operation.invalid_input", "casefileVersion"],
    ]);
    expect(await codes({ skillsInto: [".cursor/skills"] })).toEqual([
      ["operation.invalid_input", "skillsInto.0"],
    ]);
    expect(
      await codes({
        skills: [{ path: "../x/SKILL.md", text: "" }],
        skillsInto: [".claude/skills"],
      }),
    ).toEqual([["operation.invalid_input", "skills.0.path"]]);
  });

  it("is a human operation", async () => {
    const result = await init({}, "agent");
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual([
      "operation.actor_not_allowed",
    ]);
  });
});

describe("init in an upgraded workspace (#152)", () => {
  const SHIPPED = [
    ...SKILLS,
    { path: "qa-bootstrap/reference.md", text: "# reference\n" },
    { path: "qa-review/SKILL.md", text: "# review\n" },
  ];
  const setUp = async () => {
    await put("casefile.yaml", "version: 1\nprojects: []\n");
    await put(".casefile/package.json", "{}");
    await put(".casefile/.gitignore", "node_modules/\n");
  };

  it("says which kept skills differ and which are new, and writes no skill", async () => {
    await setUp();
    await put(".claude/skills/casefile-setup/SKILL.md", "# setup\n");
    await put(".claude/skills/qa-bootstrap/SKILL.md", "# bootstrap\n");
    // Older text in a file of the skill; an extra local file is not a difference.
    await put(".claude/skills/qa-bootstrap/reference.md", "# old reference\n");
    await put(".claude/skills/qa-bootstrap/notes.md", "# mine\n");
    const result = await init({ skills: SHIPPED });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.created).toEqual([]);
    expect(result.value.stale).toEqual([".claude/skills/qa-bootstrap"]);
    expect(result.value.skillsOffered).toEqual(["qa-review"]);
    expect(result.value.next.slice(0, 2)).toEqual([
      "This version adds skills (qa-review): casefile init --skills-into .claude/skills.",
      "Kept skills differ from this version's (.claude/skills/qa-bootstrap): init never overwrites them. If you did not edit them, replace them: rm -rf .claude/skills/qa-bootstrap && casefile init --skills-into .claude/skills",
    ]);
    expect(await read(".claude/skills/qa-bootstrap/reference.md")).toBe("# old reference\n");
    await expect(read(".claude/skills/qa-review/SKILL.md")).rejects.toThrow();
  });

  it("offers nothing when the skills there are this version's", async () => {
    await setUp();
    for (const file of SHIPPED) await put(`.agents/skills/${file.path}`, file.text);
    const result = await init({ skills: SHIPPED });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value).toMatchObject({ skillsOffered: [], stale: [] });
    expect(result.value.next).toHaveLength(2);
  });

  it("names every target that differs in one replace command", async () => {
    await setUp();
    await put(".claude/skills/casefile-setup/SKILL.md", "# old\n");
    await put(".agents/skills/casefile-setup/SKILL.md", "# old\n");
    const result = await init({ skills: SKILLS });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.stale).toEqual([
      ".claude/skills/casefile-setup",
      ".agents/skills/casefile-setup",
    ]);
    expect(result.value.next[1]).toContain(
      "rm -rf .claude/skills/casefile-setup .agents/skills/casefile-setup && casefile init --skills-into .claude/skills --skills-into .agents/skills",
    );
  });
});

describe("init says which skill to run next (#152)", () => {
  const nextOf = async () => {
    const result = await init({});
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.value.next.slice(0, -1);
  };

  it("/casefile-setup while the workspace has no projects", async () => {
    expect(await nextOf()).toEqual([expect.stringContaining("/casefile-setup")]);
  });

  it("/qa-bootstrap for each project without cases", async () => {
    await put("casefile.yaml", "version: 1\nprojects:\n  - { name: web, path: . }\n");
    await put("context/tests/_common.yaml", "{}\n");
    expect(await nextOf()).toEqual([expect.stringContaining("/qa-bootstrap web")]);
  });

  it("/qa-review and /qa-cover once projects have cases", async () => {
    await cp(DEMO_ROOT, root, { recursive: true });
    const next = await nextOf();
    expect(next).toHaveLength(1);
    expect(next[0]).toContain("/qa-review");
    expect(next[0]).toContain("/qa-cover");
  });

  it("casefile validate when casefile.yaml does not load", async () => {
    await put("casefile.yaml", "version: [\n");
    expect(await nextOf()).toEqual([expect.stringContaining("casefile validate")]);
  });
});

describe("readSkillBundle", () => {
  it("reads every file, relative and sorted", async () => {
    await put("bundle/qa-bootstrap/SKILL.md", "# b\n");
    await put("bundle/casefile-setup/SKILL.md", "# a\n");
    await put("bundle/casefile-setup/refs/flow.md", "flow\n");
    expect(await readSkillBundle(join(root, "bundle"))).toEqual([
      { path: "casefile-setup/SKILL.md", text: "# a\n" },
      { path: "casefile-setup/refs/flow.md", text: "flow\n" },
      { path: "qa-bootstrap/SKILL.md", text: "# b\n" },
    ]);
  });

  it("is empty when the package ships no skills", async () => {
    expect(await readSkillBundle(join(root, "missing"))).toEqual([]);
  });
});
