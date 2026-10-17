import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MONOREPO_ROOT } from "../demo.fixture.js";
import { builtinOperations } from "../operations/builtins.js";
import { loadExtensions } from "../operations/extensions.js";
import { openRegistry } from "../operations/host.js";
import type { Actor } from "../operations/operation.js";
import { createRegistry } from "../operations/registry.js";
import { RunEvent } from "../schema/index.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/junit/", import.meta.url));
const registry = createRegistry();
for (const operation of builtinOperations) registry.register(operation);

const REPORT = "apps/web/test-results/junit.xml";
const RUNS = "apps/web/context/tests/.runs";
const TC_0002 = "apps/web/context/tests/login/TC-0002.md";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-ingest-"));
  await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
  await put(REPORT, await readFile(join(FIXTURES, "playwright.xml"), "utf8"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};
const read = (path: string) => readFile(join(root, path), "utf8");

type Ingested = {
  project: string;
  run: string;
  path: string;
  results: number;
  events: number;
  appended: number;
  unmatched: { ref: string; status: string }[];
  next: string[];
};

const base = { report: REPORT, run: "pw-1", executor: "ci:github-actions", project: "web" };
const ingest = (input: Record<string, unknown> = {}, actor: Actor = "ci") =>
  registry.invoke("ingest-junit", { ...base, ...input }, { root, actor });
const ingested = async (input: Record<string, unknown> = {}, actor: Actor = "ci") => {
  const result = await ingest(input, actor);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value as Ingested;
};
const events = async (path = `${RUNS}/pw-1.jsonl`) =>
  (await read(path))
    .trimEnd()
    .split("\n")
    .map((line) => RunEvent.parse(JSON.parse(line)));

/** Gives TC-0002 an `automation.ref`, as `cover` would have. */
async function setRef(path: string, ref: string) {
  const text = await read(path);
  await put(path, text.replace("priority: P1\n", `priority: P1\nautomation:\n  ref: ${ref}\n`));
}

describe("ingest junit", () => {
  it("appends one event per matched case and reports the unmatched results", async () => {
    const value = await ingested({ env: "staging", build: "web-2.1.0+9" });
    expect(value).toEqual({
      project: "web",
      run: "pw-1",
      path: `${RUNS}/pw-1.jsonl`,
      results: 6,
      events: 1,
      appended: 1,
      unmatched: [
        { ref: "login.spec.ts::rejects an empty password", status: "failed" },
        {
          ref: "login.spec.ts::password reset › sends a reset link to a registered email",
          status: "passed",
        },
        { ref: "login.spec.ts::locks the account after five failed attempts", status: "skipped" },
        { ref: "login.spec.ts::signs out from the account menu", status: "passed" },
        { ref: "search.spec.ts::finds a product by name & shows its price", status: "passed" },
      ],
      next: [
        `Commit ${RUNS}/pw-1.jsonl: casefile reads runs from the repository, and ingest commits nothing`,
        "5 results match no case's automation.ref: set that ref on the case it verifies (`casefile spec cover`), or leave it unmatched",
      ],
    });
    expect(await read(`${RUNS}/pw-1.jsonl`)).toBe(
      `${JSON.stringify({
        run_id: "pw-1",
        case_id: "TC-0001",
        status: "passed",
        executor: "ci:github-actions",
        at: "2026-10-17T09:12:03Z",
        env: "staging",
        build: "web-2.1.0+9",
        duration_ms: 1204,
        automation_ref: "login.spec.ts::signs in with valid credentials",
      })}\n`,
    );
  });

  it("is idempotent: the same report twice writes nothing the second time", async () => {
    await setRef(TC_0002, "login.spec.ts::rejects an empty password");
    await ingested();
    const first = await read(`${RUNS}/pw-1.jsonl`);
    const again = await ingested();
    expect(again).toMatchObject({ events: 2, appended: 0 });
    expect(again.next[0]).toBe(`Nothing new: every event is already in ${RUNS}/pw-1.jsonl`);
    expect(await read(`${RUNS}/pw-1.jsonl`)).toBe(first);
  });

  it("is idempotent without report times too: `at` is not part of an event's identity", async () => {
    const report = (await read(REPORT)).replaceAll(/ timestamp="[^"]*"/g, "");
    await put(REPORT, report);
    await ingested();
    const first = await read(`${RUNS}/pw-1.jsonl`);
    expect((await ingested()).appended).toBe(0);
    expect(await read(`${RUNS}/pw-1.jsonl`)).toBe(first);
  });

  it("appends a second shard of the same run after the existing lines, byte for byte", async () => {
    await setRef(TC_0002, "login.spec.ts::rejects an empty password");
    // An existing run file another writer left without a final newline.
    const existing = `{"case_id":"TC-0001","run_id":"pw-1","status":"passed","executor":"ci:github-actions","at":"2026-10-17T09:00:00Z","duration_ms":1204,"automation_ref":"login.spec.ts::signs in with valid credentials"}`;
    await put(`${RUNS}/pw-1.jsonl`, existing);
    const value = await ingested();
    expect(value).toMatchObject({ events: 2, appended: 1 });
    const text = await read(`${RUNS}/pw-1.jsonl`);
    expect(text.startsWith(`${existing}\n`)).toBe(true);
    expect((await events()).map((e) => [e.case_id, e.status])).toEqual([
      ["TC-0001", "passed"],
      ["TC-0002", "failed"],
    ]);
  });

  it("skips run-file lines that are not events when it compares, and keeps them", async () => {
    await put(`${RUNS}/pw-1.jsonl`, "not json\n[1]\n");
    expect(await ingested()).toMatchObject({ appended: 1 });
    expect((await read(`${RUNS}/pw-1.jsonl`)).startsWith("not json\n[1]\n{")).toBe(true);
  });

  it("writes one event with the worst status when a test ran in several Playwright projects", async () => {
    const suite = (project: string, time: string, body: string) =>
      `<testsuite name="login.spec.ts" timestamp="${time}" hostname="${project}"><testcase name="signs in with valid credentials" classname="login.spec.ts" time="${project === "firefox" ? "2.5" : "1"}">${body}</testcase></testsuite>`;
    // Same suite time in every project: separate events would tie on `at`.
    await put(
      REPORT,
      `<testsuites>${suite("chromium", "2026-10-17T09:12:03Z", "")}${suite("firefox", "2026-10-17T09:12:03Z", '<failure message="x"/>')}${suite("webkit", "2026-10-17T09:12:03Z", "<skipped/>")}</testsuites>`,
    );
    expect(await ingested()).toMatchObject({ results: 3, events: 1, appended: 1 });
    expect(await events()).toEqual([
      {
        run_id: "pw-1",
        case_id: "TC-0001",
        status: "failed",
        executor: "ci:github-actions",
        at: "2026-10-17T09:12:03Z",
        duration_ms: 2500,
        evidence: [
          { kind: "result:passed", ref: "chromium" },
          { kind: "result:failed", ref: "firefox" },
          { kind: "result:skipped", ref: "webkit" },
        ],
        automation_ref: "login.spec.ts::signs in with valid credentials",
      },
    ]);
    expect(await ingested()).toMatchObject({ appended: 0 });
    expect(await events()).toHaveLength(1);
  });

  it("merges unmatched results by ref too, takes the latest time, and numbers sources it lacks", async () => {
    await put(
      REPORT,
      `<testsuites>
<testsuite name="a.spec.ts" timestamp="2026-10-17T09:00:00Z"><testcase name="t" classname="a.spec.ts"><skipped/></testcase></testsuite>
<testsuite name="a.spec.ts" timestamp="2026-10-17T09:05:00+01:00"><testcase name="t" classname="a.spec.ts"/></testsuite>
<testsuite name="a.spec.ts" timestamp="2026-10-17T08:30:00Z"><testcase name="t" classname="a.spec.ts"/></testsuite>
</testsuites>`,
    );
    expect(await ingested({ run: "pw-0" })).toMatchObject({
      results: 3,
      events: 0,
      unmatched: [{ ref: "a.spec.ts::t", status: "passed" }],
    });
    await setRef(TC_0002, "a.spec.ts::t");
    expect(await ingested()).toMatchObject({ results: 3, events: 1, unmatched: [] });
    expect((await events())[0]).toMatchObject({
      case_id: "TC-0002",
      status: "passed",
      at: "2026-10-17T09:00:00Z",
      evidence: [
        { kind: "result:skipped", ref: "#1" },
        { kind: "result:passed", ref: "#2" },
        { kind: "result:passed", ref: "#3" },
      ],
    });
  });

  it("gives one event per case when several cases share a ref", async () => {
    await setRef(TC_0002, "login.spec.ts::signs in with valid credentials");
    expect(await ingested()).toMatchObject({ events: 2, appended: 2 });
    expect((await events()).map((e) => e.case_id)).toEqual(["TC-0001", "TC-0002"]);
  });

  it("makes a matched case automated and keeps the workspace valid", async () => {
    await setRef(TC_0002, "login.spec.ts::rejects an empty password");
    await ingested();
    const query = await registry.invoke(
      "query",
      { query: "automation.status = automated", project: "web" },
      { root, actor: "human" },
    );
    expect(query).toMatchObject({ ok: true });
    if (!query.ok) return;
    const refs = (query.value as { cases: { ref: string }[] }).cases.map((c) => c.ref);
    expect(refs).toContain("web/TC-0002");
    const validate = await registry.invoke("validate", {}, { root, actor: "human" });
    const findings = validate.ok
      ? (validate.value as { findings: { path?: string }[] }).findings
      : validate.errors;
    expect(findings.filter((f) => f.path?.startsWith(RUNS))).toEqual([]);
  });

  it("lets an agent ingest as agent:<name>", async () => {
    expect(await ingested({ executor: "agent:claude-code" }, "agent")).toMatchObject({
      appended: 1,
    });
    expect((await events())[0]?.executor).toBe("agent:claude-code");
  });

  it.each([
    [{ executor: "agent:claude-code" }, "ci", "ingest.executor_mismatch"],
    [{ executor: "human:qa@acme.example" }, "ci", "ingest.executor_mismatch"],
    [{}, "human", "operation.actor_not_allowed"],
    [{ report: "apps/web/test-results/missing.xml" }, "ci", "ingest.report_missing"],
    [{ report: "../outside.xml" }, "ci", "path.outside_workspace"],
    [{ project: undefined }, "ci", "project.required"],
    [{ project: "mobile" }, "ci", "project.unknown"],
    [{ run: "../escape" }, "ci", "operation.invalid_input"],
    [{ executor: "github" }, "ci", "operation.invalid_input"],
  ] as const)("refuses %j as %s with %s, writing nothing", async (input, actor, code) => {
    const result = await ingest(input, actor);
    expect(result).toMatchObject({ ok: false, errors: [{ code }] });
    await expect(read(`${RUNS}/pw-1.jsonl`)).rejects.toThrow();
  });

  it("reports an invalid report with its location and writes nothing", async () => {
    await put(REPORT, "<testsuites>\n<testsuite>\n</testsuites>");
    expect(await ingest()).toEqual({
      ok: false,
      errors: [
        {
          code: "ingest.invalid_report",
          path: REPORT,
          line: 3,
          column: 1,
          message: "</testsuites> does not close <testsuite>",
        },
      ],
    });
  });

  it("keeps an existing run file's lines when it appends to it", async () => {
    const before = await read(`${RUNS}/2026-10-14-ci-web.jsonl`);
    await ingested({ run: "2026-10-14-ci-web" });
    const after = await read(`${RUNS}/2026-10-14-ci-web.jsonl`);
    expect(after.startsWith(before)).toBe(true);
  });
});

describe("an extension's ingester", () => {
  /** A format of `<ref> <status>` lines; the duck-typed fixture needs no zod in the temp dir. */
  const LINES = `export const manifest = {
  ingesters: [{
    format: "lines",
    spec: "specs/lines.md",
    parse(text) {
      return { ok: true, value: text.split("\\n").filter(Boolean).map((line) => {
        const [ref, status] = line.split(" | ");
        return { ref, status };
      }) };
    },
  }],
};`;

  async function install(source: string) {
    const dir = ".casefile/node_modules/@acme/casefile-ingest-lines";
    await put(`${dir}/package.json`, JSON.stringify({ version: "1.0.0", type: "module" }));
    await put(`${dir}/index.js`, source);
    await put(`${dir}/specs/lines.md`, "# ingest lines\n\nReads `<ref> | <status>` lines.\n");
    await appendFile(
      join(root, "casefile.yaml"),
      `extensions:\n  - "@acme/casefile-ingest-lines"\n`,
    );
  }

  it("registers as ingest-<format> with its own SPEC, without core changes", async () => {
    await install(LINES);
    const host = await openRegistry(root);
    expect(host.errors).toEqual([]);
    expect(host.specs.get("ingest-lines")).toBe(
      join(root, ".casefile/node_modules/@acme/casefile-ingest-lines/specs/lines.md"),
    );
    await put("results.txt", "login.spec.ts::signs in with valid credentials | failed\n");
    const result = await host.registry.invoke(
      "ingest-lines",
      { ...base, report: "results.txt", run: "lines-1" },
      { root, actor: "ci" },
    );
    expect(result).toMatchObject({ ok: true, value: { events: 1, appended: 1 } });
    const [event] = await events(`${RUNS}/lines-1.jsonl`);
    expect(event).toMatchObject({ case_id: "TC-0001", status: "failed", run_id: "lines-1" });
  });

  it("has its results validated, so it cannot write a malformed event", async () => {
    await install(LINES);
    const host = await openRegistry(root);
    await put("results.txt", "a::b | green\n");
    const result = await host.registry.invoke(
      "ingest-lines",
      { ...base, report: "results.txt", run: "lines-1" },
      { root, actor: "ci" },
    );
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "ingest.invalid_result", path: "results.txt", field: "results.0.status" }],
    });
  });

  it.each([
    ["an array", "[{ ref, status }]"],
    ["ok without a list", "{ ok: true, value: 3 }"],
    ["a failure without errors", "{ ok: false }"],
  ])("cannot pass off %s as its Result", async (_, value) => {
    await install(
      LINES.replace(
        /return \{ ok: true[\s\S]*?\) \};/,
        `const ref = "", status = ""; return ${value};`,
      ),
    );
    const host = await openRegistry(root);
    await put("results.txt", "x\n");
    const result = await host.registry.invoke(
      "ingest-lines",
      { ...base, report: "results.txt", run: "lines-1" },
      { root, actor: "ci" },
    );
    expect(result).toMatchObject({ ok: false, errors: [{ code: "ingest.invalid_result" }] });
  });

  it("is refused at load when it is not an ingester", async () => {
    await install(
      `export const manifest = { ingesters: [{ format: "Lines!" }, { format: "x" }] };`,
    );
    const { extensions, errors } = await loadExtensions(root, ["@acme/casefile-ingest-lines"]);
    expect(extensions).toEqual([]);
    expect(errors).toEqual([
      {
        code: "extension.invalid_manifest",
        path: "casefile.yaml",
        field: "extensions.0",
        message:
          "@acme/casefile-ingest-lines: `manifest.ingesters`: ingester format 'Lines!' is not a slug; ingester 'x' has no parse()",
      },
    ]);
  });

  it("cannot take over a built-in format", async () => {
    await install(LINES.replace('format: "lines"', 'format: "junit"'));
    const host = await openRegistry(root);
    expect(host.errors).toMatchObject([{ code: "operation.duplicate" }]);
    expect(host.specs.get("ingest-junit")).toMatch(/core\/specs\/ingest\.md$/);
  });
});
