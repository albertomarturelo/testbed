import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nextCaseId } from "@casefile/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The demo oracles live in core's sources (CONVENTIONS 6); tests may read them across the boundary.
import { DEMO_EXPECTED, DEMO_MONOREPO_EXPECTED } from "../../../packages/core/src/demo.fixture.js";
import { run } from "./cli.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DEMO = join(REPO, "examples/demo-repo");
const MONOREPO = join(REPO, "examples/demo-monorepo");
const BROKEN = join(REPO, "packages/core/fixtures/broken");
const CASES = DEMO_EXPECTED.caseIds.length;
const casesOf = (project?: string) =>
  DEMO_MONOREPO_EXPECTED.caseRefs.filter(
    (ref) => project === undefined || ref.startsWith(`${project}/`),
  ).length;

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
    expect((await cli(["spec", "query-grammar"])).stdout).toContain("## Syntax (EBNF)");
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
      stdout: `projects: 1\ncases: ${CASES}\nwarnings: 0\nfindings: (none)`,
      stderr: "",
    });
  });

  it("prints the Result as JSON with --json", async () => {
    const result = await cli(["validate", "--json", "--cwd", DEMO]);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      value: { projects: 1, cases: CASES, warnings: 0, findings: [] },
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
    expect(JSON.parse(all.stdout).value).toMatchObject({ projects: 2, cases: casesOf() });
    const inside = await cli(["validate", "--json", "--cwd", join(MONOREPO, "apps/web/context")]);
    expect(JSON.parse(inside.stdout).value).toMatchObject({ projects: 1, cases: casesOf("web") });
    const named = await cli(["validate", "--json", "--cwd", MONOREPO, "--project", "api"]);
    expect(JSON.parse(named.stdout).value).toMatchObject({ projects: 1, cases: casesOf("api") });
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
    // The bundled skills are offered first, with the command that copies them.
    expect(init.stdout).toMatch(
      /\nNext:\n {2}- Copy the shipped skills \(casefile-setup, qa-cover\)[^\n]*\n {2}- Run \/casefile-setup in your agent/,
    );
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

  it("runs init again at the workspace root from a subdirectory, never nesting one", async () => {
    await cli(["init", "--cwd", tmp]);
    await mkdir(join(tmp, "apps/web"), { recursive: true });
    const again = await cli(["init", "--cwd", join(tmp, "apps/web")]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("created: (none)");
    await expect(readFile(join(tmp, "apps/web/casefile.yaml"), "utf8")).rejects.toThrow();
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
    // The repository's skills/ is the bundle: both targets get every skill.
    for (const target of [".claude/skills", ".agents/skills"]) {
      for (const [skill, spec] of [
        ["casefile-setup", "setup"],
        ["qa-cover", "cover"],
      ] as const) {
        const text = await readFile(join(tmp, target, skill, "SKILL.md"), "utf8");
        expect(text).toContain(`name: ${skill}\n`);
        // Skills cite their SPEC instead of restating it (CONVENTIONS 8).
        expect(text).toContain(`casefile spec ${spec}`);
      }
    }
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

  it("rejects, naming the clash, an operation whose input shadows a global flag", async () => {
    const dir = ".casefile/node_modules/@acme/hello";
    const clash = EXTENSION.replace('name: "hello-world"', 'name: "clash"')
      .replace("who: ", "cwd: ")
      .replace('subject: "who",', "");
    await put(`${dir}/index.js`, clash);
    const result = await cli(["clash", "x", "--cwd", tmp]);
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "error  cli.flag_conflict  [cwd]  'clash' input 'cwd' clashes with the global --cwd",
    });
    expect((await cli(["frob", "--cwd", tmp])).stderr).toContain(
      "note: 'clash' input 'cwd' clashes with the global --cwd",
    );
  });

  it("reports the extension when a command is unknown and it failed to load", async () => {
    await put("casefile.yaml", "version: 1\nprojects: []\nextensions: ['@acme/absent']\n");
    const result = await cli(["hello", "world", "ada", "--cwd", tmp]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("note: @acme/absent is not installed");
  });
});

describe("casefile resolve, query, id next", () => {
  it("resolves a case with each inherited value's origin", async () => {
    const result = await cli(["resolve", "TC-0003", "--cwd", DEMO]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ref: ${DEMO_EXPECTED.project}/TC-0003`);
    expect(result.stdout).toMatch(/\n {2}field +value +origin\n/);
    // Each file of the commons chain shows up as an origin.
    for (const file of DEMO_EXPECTED.tc0003CommonsChain) expect(result.stdout).toContain(file);
    expect(result.stdout).toMatch(/\n {2}priority +\S+ +context\/tests\//);
  });

  it("asks to qualify an ambiguous id; resolves a qualified one", async () => {
    const ambiguous = await cli(["resolve", "TC-0001", "--cwd", MONOREPO]);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain("case.ambiguous");
    expect(ambiguous.stderr).toContain("use web/TC-0001 or --project");
    const qualified = await cli(["resolve", "web/TC-0001", "--cwd", MONOREPO]);
    expect(qualified.code).toBe(0);
    expect(qualified.stdout).toContain("ref: web/TC-0001");
    // Inside a project, a bare id is that project's.
    const inside = await cli(["resolve", "TC-0001", "--cwd", join(MONOREPO, "services/api")]);
    expect(inside.stdout).toContain("ref: api/TC-0001");
  });

  it("lists the matching cases as a table", async () => {
    const [query, ids] = Object.entries(DEMO_EXPECTED.queries)[0] as [string, readonly string[]];
    const result = await cli(["query", query, "--cwd", DEMO]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`count: ${ids.length}`);
    expect(result.stdout).toMatch(/\n {2}ref +state +priority +title\n/);
    for (const id of ids) expect(result.stdout).toContain(`${DEMO_EXPECTED.project}/${id}`);
  });

  it("points at a DSL error with a caret and exits 1", async () => {
    const result = await cli(["query", "state = active AND (priority = P0", "--cwd", DEMO]);
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: [
        "error  query.unexpected_end  column 34 [query]  expected `)`, but the query ends",
        "  state = active AND (priority = P0",
        `  ${" ".repeat(33)}^`,
      ].join("\n"),
    });
    const json = JSON.parse((await cli(["query", "state =", "--json", "--cwd", DEMO])).stdout);
    expect(json.errors[0]).toMatchObject({
      code: "query.unexpected_end",
      column: 8,
      field: "query",
    });
  });

  it("prints the next id of the current or the selected project", async () => {
    const single = await cli(["id", "next", "--cwd", DEMO]);
    expect(single).toEqual({
      code: 0,
      stdout: `project: ${DEMO_EXPECTED.project}\nid: ${nextCaseId(DEMO_EXPECTED.caseIds)}`,
      stderr: "",
    });
    const root = await cli(["id", "next", "--cwd", MONOREPO]);
    expect(root.code).toBe(1);
    expect(root.stderr).toContain("project.required");
    const selected = await cli(["id", "next", "--cwd", MONOREPO, "--project", "web"]);
    expect(selected.stdout).toContain("project: web\nid: TC-");
  });

  it("lists the new commands with their SPEC summaries", async () => {
    const help = (await cli([])).stdout;
    expect(help).toMatch(/id next\s+Prints the next free case id of a project/);
    expect(help).toMatch(/query\s+Lists the cases a query selects\./);
    expect(help).toMatch(/resolve\s+Shows one case as casefile sees it after inheritance/);
  });
});

describe("casefile ingest junit", () => {
  const report = "apps/web/test-results/junit.xml";
  const argv = (...extra: string[]) => [
    "ingest",
    "junit",
    report,
    "--run",
    "9137",
    "--executor",
    "ci:github-actions",
    "--cwd",
    join(tmp, "apps/web"),
    ...extra,
  ];
  beforeEach(async () => {
    await cp(MONOREPO, tmp, { recursive: true });
    await put(report, await readFile(join(BROKEN, "../junit/playwright.xml"), "utf8"));
  });

  it("appends the matched events of the project at --cwd and lists the unmatched", async () => {
    const result = await cli(argv("--build", "web-2.1.0+9"), { CASEFILE_ACTOR: "ci" });
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("path: apps/web/context/tests/.runs/9137.jsonl");
    expect(result.stdout).toContain("appended: 1");
    expect(result.stdout).toMatch(/unmatched:\n\s+ref\s+status\n/);
    expect(result.stdout).toMatch(/login\.spec\.ts::rejects an empty password\s+failed/);
    expect(result.stdout).toContain("Next:");
    const run = await readFile(join(tmp, "apps/web/context/tests/.runs/9137.jsonl"), "utf8");
    expect(JSON.parse(run)).toMatchObject({ case_id: "TC-0001", build: "web-2.1.0+9" });

    const again = await cli(argv("--build", "web-2.1.0+9", "--json"), { CASEFILE_ACTOR: "ci" });
    expect(JSON.parse(again.stdout)).toMatchObject({ ok: true, value: { appended: 0 } });
  });

  it("is refused to a human", async () => {
    const result = await cli(argv());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("operation.actor_not_allowed");
  });

  it("is listed with the other commands", async () => {
    expect((await cli([])).stdout).toMatch(/ingest junit\s+Turns a test report into run events/);
  });
});
