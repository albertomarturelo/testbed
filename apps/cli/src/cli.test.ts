import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./cli.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DEMO = join(REPO, "examples/demo-repo");
const MONOREPO = join(REPO, "examples/demo-monorepo");
const BROKEN = join(REPO, "packages/core/fixtures/broken");

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "casefile-cli-"));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(tmp, path)), { recursive: true });
  await writeFile(join(tmp, path), text);
};

/** Runs the CLI from the repo root, as `pnpm casefile` does. */
const cli = (argv: string[], env: Record<string, string> = {}, cwd = REPO) =>
  run(argv, { cwd, env });

describe("casefile cli: host commands", () => {
  it("prints usage with the registry's commands and their SPEC summaries", async () => {
    const result = await cli([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: casefile <command> [subject] [flags]");
    expect(result.stdout).toMatch(/project add\s+Registers a project in `casefile.yaml`/);
    expect(result.stdout).toMatch(/validate\s+Checks the whole workspace/);
    expect((await cli(["--help"])).stdout).toBe(result.stdout);
  });

  it("prints the package version", async () => {
    const result = await cli(["--version"]);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects unknown commands with exit code 1", async () => {
    const result = await cli(["frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown command 'frobnicate'");
  });

  it("asks for the command before the flags", async () => {
    expect(await cli(["--cwd", DEMO, "validate"])).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "error  cli.usage  the command comes first: casefile <command> [subject] [flags], not '--cwd'",
    });
  });

  it("prints any operation's SPEC, by name or by words, and core topics", async () => {
    expect((await cli(["spec", "project-add"])).stdout).toMatch(/^# project-add\n/);
    expect((await cli(["spec", "project", "add"])).stdout).toMatch(/^# project-add\n/);
    expect((await cli(["spec", "validate"])).stdout).toContain("## Output");
    expect(await cli(["spec", "nope"])).toEqual({
      code: 1,
      stdout: "",
      stderr: "error  spec.unknown  no operation or topic SPEC named 'nope'",
    });
    expect((await cli(["spec"])).code).toBe(1);
    expect(JSON.parse((await cli(["spec", "nope", "--json"])).stdout)).toMatchObject({ ok: false });
  });

  it("prints one command's help from its input and SPEC", async () => {
    const result = await cli(["project", "add", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: casefile project add <name> [flags]");
    expect(result.stdout).toContain("--path <value>  (required)");
    expect(result.stdout).toContain("Actor: agent");
    expect(result.stdout).toContain("Full SPEC: casefile spec project-add");
    const init = await cli(["init", "--help"]);
    expect(init.stdout).toContain("--skills-into <.claude/skills|.agents/skills>  (repeatable)");
    expect(init.stdout).not.toContain("--casefile-version");
  });
});

describe("casefile validate", () => {
  it("exits 0 on the demo and reports counts", async () => {
    const result = await cli(["validate", "--cwd", "examples/demo-repo"]);
    expect(result).toEqual({
      code: 0,
      stdout: "projects: 1\ncases: 8\nwarnings: 0\nfindings: (none)",
      stderr: "",
    });
  });

  it("prints the Result as JSON with --json", async () => {
    const result = await cli(["validate", "--json", "--cwd", DEMO]);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      value: { projects: 1, cases: 8, warnings: 0, findings: [] },
    });
  });

  it("exits 1 with every finding, as diagnostics or as JSON", async () => {
    const cwd = join(BROKEN, "label-undeclared");
    const human = await cli(["validate", "--cwd", cwd]);
    expect(human.code).toBe(1);
    expect(human.stderr).toContain(
      "error  label.undeclared  context/tests/_common.yaml [labels.team]  label 'team' is not declared",
    );
    expect(human.stderr).toContain("  hint: declare `team` under `properties:`");
    expect(human.stderr.endsWith("3 errors, 0 warnings")).toBe(true);

    const json = await cli(["validate", "--json", "--cwd", cwd]);
    expect(json.code).toBe(1);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0]).toMatchObject({
      code: "label.undeclared",
      severity: "error",
      path: "casefile.yaml",
      field: "commons.labels.org",
      hint: expect.any(String),
    });
  });

  it("exits 0 with warnings only", async () => {
    const result = await cli(["validate", "--cwd", join(BROKEN, "toolchain-unpinned")]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("warning  toolchain.unpinned  .casefile/package.json");
  });

  it("exits 2 without a workspace", async () => {
    const result = await cli(["validate", "--cwd", tmp]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("workspace.missing");
    const json = await cli(["validate", "--cwd", tmp, "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.stdout).errors[0].code).toBe("workspace.missing");
  });

  it("acts on the project containing --cwd, or the one --project names", async () => {
    const all = await cli(["validate", "--json", "--cwd", MONOREPO]);
    expect(JSON.parse(all.stdout).value).toMatchObject({ projects: 2, cases: 3 });
    const inside = await cli(["validate", "--json", "--cwd", join(MONOREPO, "apps/web/context")]);
    expect(JSON.parse(inside.stdout).value).toMatchObject({ projects: 1, cases: 2 });
    const named = await cli(["validate", "--json", "--cwd", MONOREPO, "--project", "api"]);
    expect(JSON.parse(named.stdout).value).toMatchObject({ projects: 1, cases: 1 });
    const unknown = await cli(["validate", "--cwd", MONOREPO, "--project", "nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("project.unknown");
  });

  it("resolves --cwd against the process directory, also as --cwd=", async () => {
    const result = await cli(["validate", "--cwd=demo-repo"], {}, join(REPO, "examples"));
    expect(result.code).toBe(0);
  });
});

describe("casefile init → project add", () => {
  it("scaffolds a workspace and prints the next steps", async () => {
    const init = await cli(["init", "--cwd", tmp]);
    expect(init.code).toBe(0);
    expect(init.stdout).toContain("created:\n  - casefile.yaml");
    expect(init.stdout).toMatch(/\nNext:\n {2}- Run \/casefile-setup in your agent/);
    expect(init.stdout).toContain("gpg.format ssh");
    const pinned = JSON.parse(await readFile(join(tmp, ".casefile/package.json"), "utf8"));
    expect(pinned.dependencies.casefile).toMatch(/^\d+\.\d+\.\d+$/);

    await mkdir(join(tmp, "apps/web"), { recursive: true });
    const asHuman = await cli(["project", "add", "web", "--path", "apps/web", "--cwd", tmp]);
    expect(asHuman.code).toBe(1);
    expect(asHuman.stderr).toContain("operation.actor_not_allowed");

    const agent = { CASEFILE_ACTOR: "agent" };
    const added = await cli(["project", "add", "web", "--path", "apps/web", "--cwd", tmp], agent);
    expect(added.code).toBe(0);
    expect(added.stdout).toContain("path: apps/web");
    expect(await readFile(join(tmp, "casefile.yaml"), "utf8")).toContain("name: web");

    // The scaffold leaves decisions pending: validate lists them and exits 1.
    const validate = await cli(["validate", "--json", "--cwd", tmp], agent);
    expect(validate.code).toBe(1);
    expect(JSON.parse(validate.stdout).errors.map((e: { code: string }) => e.code)).toContain(
      "scaffold.todo",
    );
  });

  it("copies skills with a repeatable enum flag", async () => {
    const result = await cli([
      "init",
      "--cwd",
      tmp,
      "--skills-into",
      ".claude/skills",
      "--skills-into",
      ".agents/skills",
    ]);
    expect(result.code).toBe(0);
    const bad = await cli(["init", "--cwd", tmp, "--skills-into", ".cursor/skills"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("operation.invalid_input");
  });
});

describe("casefile usage errors", () => {
  it("allows only the subject as a positional", async () => {
    const result = await cli(["project", "add", "web", "apps/web", "--cwd", tmp]);
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "error  cli.usage  unexpected argument 'apps/web'; only the subject is positional",
    });
    expect((await cli(["validate", "extra", "--cwd", DEMO])).code).toBe(1);
  });

  it("rejects unknown flags", async () => {
    const result = await cli(["validate", "--frob", "--cwd", DEMO]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cli.usage");
    expect(result.stderr).toContain("--frob");
  });

  it("rejects an unknown actor", async () => {
    const result = await cli(["validate", "--cwd", DEMO], { CASEFILE_ACTOR: "robot" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("CASEFILE_ACTOR must be one of human, agent, ci");
    const json = await cli(["validate", "--json", "--cwd", DEMO], { CASEFILE_ACTOR: "robot" });
    expect(JSON.parse(json.stdout).errors[0].code).toBe("cli.usage");
  });

  it("needs a workspace for everything but init", async () => {
    await mkdir(join(tmp, "apps/web"), { recursive: true });
    const result = await cli(["project", "add", "web", "--path", "apps/web", "--cwd", tmp], {
      CASEFILE_ACTOR: "agent",
    });
    expect(result.code).toBe(2);
  });
});

describe("an extension's operation, without CLI changes", () => {
  // Duck-typed field schemas, as in core's extension tests: no zod in the temp dir.
  const field = (type: string, required: boolean) =>
    `{ meta: () => undefined, _zod: { def: { type: "${type}" } }, safeParse: (v) => ({ success: ${required ? "v !== undefined" : "true"}, data: v }) }`;
  const EXTENSION = `export const manifest = { operations: [{
    name: "hello-world",
    input: {
      shape: { who: ${field("string", true)}, times: ${field("number", false)}, loud: ${field("boolean", false)} },
      safeParse: (data) => ({ success: typeof data.who === "string", data, error: { issues: [{ message: "who is required", path: ["who"] }] } }),
    },
    output: { safeParse: (data) => ({ success: true, data }) },
    actor: ["human"],
    writes: [],
    spec: "specs/hello-world.md",
    subject: "who",
    async run(input) {
      const text = "hello " + input.who + (input.loud ? "!" : "");
      return { ok: true, value: { greeting: Array(input.times ?? 1).fill(text).join(" ") } };
    },
  }] };`;

  beforeEach(async () => {
    await put("casefile.yaml", "version: 1\nprojects: []\nextensions: ['@acme/hello']\n");
    const dir = ".casefile/node_modules/@acme/hello";
    await put(
      `${dir}/package.json`,
      JSON.stringify({ name: "@acme/hello", version: "1.0.0", type: "module" }),
    );
    await put(`${dir}/index.js`, EXTENSION);
    await put(`${dir}/specs/hello-world.md`, "# hello-world\n\nGreets someone.\n");
  });

  it("is listed, documented and run like a built-in", async () => {
    expect((await cli(["--help", "--cwd", tmp])).stdout).toMatch(/hello world\s+Greets someone\./);
    expect((await cli(["spec", "hello-world", "--cwd", tmp])).stdout).toBe(
      "# hello-world\n\nGreets someone.",
    );
    const help = await cli(["hello", "world", "--help", "--cwd", tmp]);
    expect(help.stdout).toContain("Usage: casefile hello world <who> [flags]");
    expect(help.stdout).toContain("--times <value>");
    expect(help.stdout).toContain("--loud\n");

    const result = await cli(["hello", "world", "ada", "--times", "2", "--loud", "--cwd", tmp]);
    expect(result).toEqual({ code: 0, stdout: "greeting: hello ada! hello ada!", stderr: "" });
  });

  it("reports the extension when a command is unknown and it failed to load", async () => {
    await put("casefile.yaml", "version: 1\nprojects: []\nextensions: ['@acme/absent']\n");
    const result = await cli(["hello", "world", "ada", "--cwd", tmp]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("note: @acme/absent is not installed");
  });
});
