import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_EXPECTED,
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  DEMO_ROOT,
  NPM_LOGIN_EXPECTED,
  NPM_LOGIN_ROOT,
} from "../demo.fixture.js";
import { nextCaseId } from "../ids.js";
import { idNextOperation } from "./id-next.js";
import { overviewOperation } from "./overview.js";
import { queryOperation } from "./query.js";
import { createRegistry } from "./registry.js";
import { resolveOperation } from "./resolve.js";
import { runsOperation } from "./runs.js";

const BROKEN = fileURLToPath(new URL("../../fixtures/broken/", import.meta.url));

const registry = createRegistry();
for (const op of [
  resolveOperation,
  queryOperation,
  idNextOperation,
  overviewOperation,
  runsOperation,
]) {
  registry.register(op);
}
const invoke = (name: string, root: string, input: Record<string, unknown> = {}) =>
  registry.invoke(name, input, { root, actor: "agent" });

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "casefile-read-"));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(tmp, path)), { recursive: true });
  await writeFile(join(tmp, path), text);
};

describe("resolve operation", () => {
  it("shows every inherited value with its origin", async () => {
    const result = await invoke("resolve", DEMO_ROOT, { ref: "TC-0003" });
    if (!result.ok) throw new Error(result.errors[0]?.message);
    const value = result.value as {
      ref: string;
      inherited: { field: string; value: string; origin: string }[];
      case: { id: string };
    };
    expect(value.ref).toBe(`${DEMO_EXPECTED.project}/TC-0003`);
    expect(value.case.id).toBe("TC-0003");
    const origins = new Set(value.inherited.map((row) => row.origin));
    for (const file of DEMO_EXPECTED.tc0003CommonsChain) expect(origins).toContain(file);
    // The innermost commons sets the priority (as the demo's README describes).
    const innermost = DEMO_EXPECTED.tc0003CommonsChain.at(-1);
    expect(value.inherited).toContainEqual(
      expect.objectContaining({ field: "priority", origin: innermost }),
    );
    expect(value.inherited).toContainEqual(
      expect.objectContaining({ field: "surfaces", value: '["web"]' }),
    );
    // A value written in the case itself is marked as such.
    expect(value.inherited.some((row) => row.origin === "(the case)")).toBe(true);
  });

  it("returns the case's Markdown body, or none (#86)", async () => {
    const withBody = await invoke("resolve", DEMO_ROOT, { ref: "TC-0003" });
    expect(withBody).toMatchObject({ ok: true, value: { body: DEMO_EXPECTED.tc0003Body } });
    const without = await invoke("resolve", DEMO_ROOT, { ref: "TC-0005" });
    if (!without.ok) throw new Error(without.errors[0]?.message);
    expect(without.value).not.toHaveProperty("body");
  });

  it("asks to qualify a bare id found in several projects", async () => {
    const [first, second] = DEMO_MONOREPO_EXPECTED.caseRefs.filter((ref) =>
      ref.endsWith("TC-0001"),
    );
    const result = await invoke("resolve", DEMO_MONOREPO_ROOT, { ref: "TC-0001" });
    expect(result).toMatchObject({ ok: false, errors: [{ code: "case.ambiguous", field: "ref" }] });
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain(String(first));
      expect(result.errors[0]?.message).toContain(String(second));
      expect(result.errors[0]?.message).toContain("--project");
    }
  });

  it("resolves a qualified ref, or a bare id within the selected project", async () => {
    for (const [input, ref] of [
      [{ ref: "web/TC-0001" }, "web/TC-0001"],
      [{ ref: "api/TC-0001" }, "api/TC-0001"],
      [{ ref: "TC-0001", project: "api" }, "api/TC-0001"],
      // The qualifier wins over the current project.
      [{ ref: "web/TC-0001", project: "api" }, "web/TC-0001"],
    ] as const) {
      const result = await invoke("resolve", DEMO_MONOREPO_ROOT, input);
      expect(result).toMatchObject({ ok: true, value: { ref } });
    }
  });

  it("fails on unknown cases, projects and malformed refs", async () => {
    expect(await invoke("resolve", DEMO_ROOT, { ref: "TC-0999" })).toEqual({
      ok: false,
      errors: [{ code: "case.unknown", field: "ref", message: "no case TC-0999 in the workspace" }],
    });
    expect(
      await invoke("resolve", DEMO_MONOREPO_ROOT, { ref: "TC-0002", project: "api" }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "case.unknown", message: "no case TC-0002 in project 'api'" }],
    });
    expect(await invoke("resolve", DEMO_ROOT, { ref: "nope/TC-0001" })).toMatchObject({
      ok: false,
      errors: [{ code: "project.unknown" }],
    });
    expect(await invoke("resolve", DEMO_ROOT, { ref: "TC-1" })).toMatchObject({
      ok: false,
      errors: [{ code: "operation.invalid_input", field: "ref" }],
    });
  });

  it("returns the resolver's errors for a case that does not resolve", async () => {
    expect(
      await invoke("resolve", join(BROKEN, "resolve-missing-field"), { ref: "TC-0001" }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "resolve.missing_field", path: "context/tests/a/TC-0001.md" }],
    });
  });

  it("returns the loader's errors when casefile.yaml cannot be read", async () => {
    expect(
      await invoke("resolve", join(BROKEN, "config-yaml-invalid"), { ref: "TC-0001" }),
    ).toMatchObject({
      ok: false,
      errors: [{ path: "casefile.yaml" }],
    });
  });
});

describe("query operation", () => {
  it.each(Object.entries(DEMO_EXPECTED.queries))("%s", async (query, ids) => {
    const result = await invoke("query", DEMO_ROOT, { query });
    expect(result).toMatchObject({ ok: true, value: { count: ids.length, unresolved: 0 } });
    if (result.ok) {
      const rows = (result.value as { cases: { ref: string }[] }).cases;
      expect(rows.map((row) => row.ref)).toEqual(ids.map((id) => `${DEMO_EXPECTED.project}/${id}`));
    }
  });

  it("returns flat rows and filters by project", async () => {
    const all = await invoke("query", DEMO_MONOREPO_ROOT, {
      query: "state != retired OR state = retired",
    });
    const api = await invoke("query", DEMO_MONOREPO_ROOT, {
      query: "state != retired OR state = retired",
      project: "api",
    });
    expect(all).toMatchObject({
      ok: true,
      value: { count: DEMO_MONOREPO_EXPECTED.caseRefs.length },
    });
    const apiRefs = DEMO_MONOREPO_EXPECTED.caseRefs.filter((ref) => ref.startsWith("api/"));
    expect(api).toMatchObject({ ok: true, value: { count: apiRefs.length } });
    if (api.ok) {
      expect((api.value as { cases: unknown[] }).cases[0]).toEqual({
        ref: apiRefs[0],
        state: expect.any(String),
        priority: expect.any(String),
        title: expect.any(String),
      });
    }
  });

  it("tags DSL errors with field `query` and keeps the column", async () => {
    expect(await invoke("query", DEMO_ROOT, { query: "state =" })).toEqual({
      ok: false,
      errors: [
        {
          code: "query.unexpected_end",
          column: 8,
          field: "query",
          message: "expected a value, but the query ends",
        },
      ],
    });
    expect(
      await invoke("query", DEMO_ROOT, { query: "feature IN release.changed_features" }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "query.unknown_variable", field: "query", column: 12 }],
    });
  });

  it("counts cases that do not resolve", async () => {
    expect(
      await invoke("query", join(BROKEN, "resolve-missing-field"), { query: "state = active" }),
    ).toMatchObject({
      ok: true,
      value: { count: 0, unresolved: 1 },
    });
  });

  it("fails on an unknown project or an unreadable config", async () => {
    expect(
      await invoke("query", DEMO_ROOT, { query: "state = active", project: "nope" }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "project.unknown" }],
    });
    expect(
      await invoke("query", join(BROKEN, "config-yaml-invalid"), { query: "x = 1" }),
    ).toMatchObject({
      ok: false,
    });
  });
});

describe("id-next operation", () => {
  it("is one above the highest id of the only project", async () => {
    expect(await invoke("id-next", DEMO_ROOT)).toEqual({
      ok: true,
      value: { project: DEMO_EXPECTED.project, id: nextCaseId(DEMO_EXPECTED.caseIds) },
    });
  });

  it("needs a project when there are several, and is per project", async () => {
    expect(await invoke("id-next", DEMO_MONOREPO_ROOT)).toMatchObject({
      ok: false,
      errors: [{ code: "project.required", field: "project" }],
    });
    for (const project of Object.keys(DEMO_MONOREPO_EXPECTED.projects)) {
      const ids = DEMO_MONOREPO_EXPECTED.caseRefs
        .filter((ref) => ref.startsWith(`${project}/`))
        .map((ref) => ref.slice(project.length + 1));
      expect(await invoke("id-next", DEMO_MONOREPO_ROOT, { project })).toEqual({
        ok: true,
        value: { project, id: nextCaseId(ids) },
      });
    }
    expect(await invoke("id-next", DEMO_ROOT, { project: "nope" })).toMatchObject({
      ok: false,
      errors: [{ code: "project.unknown" }],
    });
  });

  it("counts a case file that does not parse, and needs a readable config", async () => {
    await put("casefile.yaml", "version: 1\nprojects:\n  - { name: web, path: . }\n");
    await put("context/tests/a/TC-0007.md", "not a case\n");
    expect(await invoke("id-next", tmp)).toEqual({
      ok: true,
      value: { project: "web", id: "TC-0008" },
    });

    await put("casefile.yaml", "version: 1\nprojects: []\n");
    expect(await invoke("id-next", tmp)).toMatchObject({
      ok: false,
      errors: [{ code: "project.required", message: expect.stringContaining("has 0 (none)") }],
    });
    expect(await invoke("id-next", join(BROKEN, "config-yaml-invalid"))).toMatchObject({
      ok: false,
    });
  });
});

describe("overview operation", () => {
  it("gives each row the state a `state = draft` query matches (#87)", async () => {
    const overview = await invoke("overview", DEMO_ROOT);
    const query = await invoke("query", DEMO_ROOT, { query: "state = draft" });
    if (!overview.ok || !query.ok) throw new Error("overview or query failed");
    const drafts = (overview.value as { cases: { ref: string; state: string }[] }).cases
      .filter((row) => row.state === "draft")
      .map((row) => row.ref);
    const matched = (query.value as { cases: { ref: string }[] }).cases.map((row) => row.ref);
    expect(drafts).toEqual(matched);
    expect(drafts).toHaveLength(DEMO_EXPECTED.states.draft);
  });

  type Overview = {
    projects: { name: string; path: string; cases: number; unresolved: number }[];
    cases: Record<string, string | boolean | null>[];
  };
  const overview = async (root: string, input: Record<string, unknown> = {}) => {
    const result = await invoke("overview", root, input);
    if (!result.ok) throw new Error(result.errors[0]?.message);
    return result.value as Overview;
  };

  it("lists every project and its resolved cases with feature, automation and last run", async () => {
    const value = await overview(DEMO_MONOREPO_ROOT);
    expect(Object.fromEntries(value.projects.map((p) => [p.name, p.path]))).toEqual(
      DEMO_MONOREPO_EXPECTED.projects,
    );
    expect(value.cases.map((c) => c.ref).sort()).toEqual([...DEMO_MONOREPO_EXPECTED.caseRefs]);
    const automated = value.cases.filter((c) => c.automation === "automated").map((c) => c.ref);
    expect(automated.sort()).toEqual([...DEMO_MONOREPO_EXPECTED.derivedAutomated]);
    const rows = Object.fromEntries(
      value.cases.map(({ ref, feature, last_run, last_run_at }) => [
        ref,
        { feature, last_run, last_run_at },
      ]),
    );
    // A case that never ran has no last run (`web/TC-0002`).
    expect(rows).toEqual(DEMO_MONOREPO_EXPECTED.overview);
  });

  it("keeps only the selected project", async () => {
    const value = await overview(DEMO_MONOREPO_ROOT, { project: "api" });
    expect(value.projects.map((p) => p.name)).toEqual(["api"]);
    expect(value.cases.map((c) => c.ref)).toEqual(["api/TC-0001"]);
    const result = await invoke("overview", DEMO_MONOREPO_ROOT, { project: "nope" });
    expect(result).toMatchObject({ ok: false, errors: [{ code: "project.unknown" }] });
  });

  it("takes each case's latest run by time", async () => {
    await put("casefile.yaml", "version: 1\nprojects:\n  - { name: app, path: . }\n");
    await put(
      "context/tests/_common.yaml",
      "surfaces: [web]\nlayer: e2e\npriority: P2\nautomation:\n  eligible: true\n",
    );
    await put(
      "context/tests/login/TC-0001.md",
      [
        "---",
        "id: TC-0001",
        "feature: login",
        "title: Sign in",
        "state: active",
        "origin: agent",
        "steps:",
        "  - do: Sign in",
        "    expect: The home page opens",
        "history:",
        '  - at: "2026-10-05T09:00:00Z"',
        "    by: qa@acme.example",
        "    via: cli:cover",
        "    change: 4c1a2b3d-1e2f-4a5b-8c6d-7e8f9a0b1c01",
        "    event: created",
        "---",
        "",
      ].join("\n"),
    );
    const event = (status: string, at: string) =>
      JSON.stringify({ run_id: "r1", case_id: "TC-0001", status, executor: "human:qa", at });
    // The later event is written first: order in the file does not decide.
    await put(
      "context/tests/.runs/r1.jsonl",
      `${event("failed", "2026-10-02T00:00:00Z")}\n${event("passed", "2026-10-01T00:00:00Z")}\n`,
    );
    const value = await overview(tmp);
    expect(value.cases).toEqual([
      expect.objectContaining({
        ref: "app/TC-0001",
        feature: "login",
        last_run: "failed",
        last_run_at: "2026-10-02T00:00:00Z",
      }),
    ]);
    expect(value.projects).toEqual([{ name: "app", path: ".", cases: 1, unresolved: 0 }]);
  });

  it("gives each case's linked test and whether it can be automated", async () => {
    const value = await overview(NPM_LOGIN_ROOT);
    const rows = new Map(value.cases.map((c) => [String(c.ref).split("/")[1], c]));
    for (const id of NPM_LOGIN_EXPECTED.derivedAutomated) {
      expect(rows.get(id)).toMatchObject({ automation: "automated", eligible: true });
      expect(rows.get(id)?.automation_ref).toMatch(/^login\.spec\.ts::/);
    }
    for (const id of NPM_LOGIN_EXPECTED.manualNotEligible) {
      expect(rows.get(id)).toMatchObject({
        automation: "manual",
        automation_ref: null,
        eligible: false,
      });
    }
  });

  it("keeps a linked case manual until a CI or agent run reports its test", async () => {
    await put("casefile.yaml", "version: 1\nprojects:\n  - { name: app, path: . }\n");
    await put(
      "context/tests/_common.yaml",
      "surfaces: [web]\nlayer: e2e\npriority: P2\nautomation:\n  eligible: true\n",
    );
    await put(
      "context/tests/login/TC-0001.md",
      [
        "---",
        "id: TC-0001",
        "feature: login",
        "title: Sign in",
        "state: draft",
        "origin: agent",
        "automation:",
        "  ref: login.spec.ts::signs in",
        "steps:",
        "  - do: Sign in",
        "    expect: The home page opens",
        "history:",
        '  - at: "2026-10-05T09:00:00Z"',
        "    by: qa@acme.example",
        "    via: cli:cover",
        "    change: 4c1a2b3d-1e2f-4a5b-8c6d-7e8f9a0b1c01",
        "    event: created",
        "---",
        "",
      ].join("\n"),
    );
    const value = await overview(tmp);
    expect(value.cases).toEqual([
      expect.objectContaining({
        automation: "manual",
        automation_ref: "login.spec.ts::signs in",
        eligible: true,
        last_run: null,
      }),
    ]);
  });

  it("counts cases that do not resolve and leaves them out", async () => {
    const value = await overview(join(BROKEN, "resolve-missing-field"));
    expect(value.cases).toEqual([]);
    expect(value.projects).toEqual([{ name: "web", path: ".", cases: 0, unresolved: 1 }]);
  });
});

describe("runs operation", () => {
  type Runs = { ref: string; runs: { status: string; at: string; note?: string; path: string }[] };
  const runs = async (root: string, input: Record<string, unknown>) => {
    const result = await invoke("runs", root, input);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.value as Runs;
  };

  it("lists a qualified case's events from its own project, and none for a case that never ran", async () => {
    const value = await runs(DEMO_MONOREPO_ROOT, { ref: "api/TC-0001" });
    expect(value.ref).toBe("api/TC-0001");
    expect(value.runs.length).toBeGreaterThan(0);
    for (const run of value.runs)
      expect(run.path).toMatch(/^services\/api\/context\/tests\/\.runs\//);
    expect(await runs(DEMO_MONOREPO_ROOT, { ref: "web/TC-0002" })).toEqual({
      ref: "web/TC-0002",
      runs: [],
    });
  });

  it("refuses an unknown or ambiguous case like resolve", async () => {
    expect(await invoke("runs", DEMO_MONOREPO_ROOT, { ref: "TC-0001" })).toMatchObject({
      ok: false,
      errors: [{ code: "case.ambiguous" }],
    });
    expect(await invoke("runs", DEMO_MONOREPO_ROOT, { ref: "web/TC-0999" })).toMatchObject({
      ok: false,
      errors: [{ code: "case.unknown" }],
    });
  });

  it("puts the newest first and, on a tie, the later line; a case that does not resolve still lists", async () => {
    const root = join(tmp, "ws");
    await mkdir(root);
    await cp(join(BROKEN, "resolve-missing-field"), root, { recursive: true });
    const event = (status: string, at: string, note?: string) =>
      JSON.stringify({ run_id: "r", case_id: "TC-0001", status, executor: "ci:gh", at, note });
    await mkdir(join(root, "context/tests/.runs"));
    await writeFile(
      join(root, "context/tests/.runs/a.jsonl"),
      `${event("passed", "2026-10-01T00:00:00Z")}\n`,
    );
    await writeFile(
      join(root, "context/tests/.runs/b.jsonl"),
      [
        event("failed", "2026-10-03T00:00:00Z", "first"),
        event("failed", "2026-10-03T00:00:00Z", "second"),
        event("passed", "2026-10-02T00:00:00Z"),
        "",
      ].join("\n"),
    );
    const value = await runs(root, { ref: "TC-0001" });
    expect(value.runs.map((r) => [r.at.slice(0, 10), r.note ?? r.status, r.path])).toEqual([
      ["2026-10-03", "second", "context/tests/.runs/b.jsonl"],
      ["2026-10-03", "first", "context/tests/.runs/b.jsonl"],
      ["2026-10-02", "passed", "context/tests/.runs/b.jsonl"],
      ["2026-10-01", "passed", "context/tests/.runs/a.jsonl"],
    ]);
  });
});
