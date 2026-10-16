import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
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
      },
    });
    const config = parseConfigFile("casefile.yaml", await read("casefile.yaml"));
    expect(config).toEqual({ ok: true, value: { version: 1, projects: [] } });
    expect(JSON.parse(await read(".casefile/package.json")).dependencies).toEqual({
      casefile: "0.4.1",
    });
    expect(await read(".casefile/.gitignore")).toBe("node_modules/\n");
  });

  it("is idempotent and never overwrites", async () => {
    await put("casefile.yaml", "version: 1\nprojects: [] # mine\n");
    await put(".casefile/package.json", '{"dependencies":{"casefile":"0.1.0"}}');
    const result = await init({});
    expect(result.ok && result.value.created).toEqual([".casefile/.gitignore"]);
    expect(await read("casefile.yaml")).toBe("version: 1\nprojects: [] # mine\n");
    expect(await read(".casefile/package.json")).toContain('"0.1.0"');

    const again = await init({});
    expect(again.ok && again.value).toEqual({
      created: [],
      kept: ["casefile.yaml", ".casefile/package.json", ".casefile/.gitignore"],
      skillsOffered: [],
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
