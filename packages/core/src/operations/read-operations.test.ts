import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_EXPECTED,
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  DEMO_ROOT,
} from "../demo.fixture.js";
import { nextCaseId } from "../ids.js";
import { idNextOperation } from "./id-next.js";
import { queryOperation } from "./query.js";
import { createRegistry } from "./registry.js";
import { resolveOperation } from "./resolve.js";

const BROKEN = fileURLToPath(new URL("../../fixtures/broken/", import.meta.url));

const registry = createRegistry();
for (const op of [resolveOperation, queryOperation, idNextOperation]) registry.register(op);
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
