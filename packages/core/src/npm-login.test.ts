import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NPM_LOGIN_EXPECTED, NPM_LOGIN_ROOT } from "./demo.fixture.js";
import { loadWorkspace } from "./load/workspace.js";
import { createRegistry } from "./operations/registry.js";
import { runsOperation } from "./operations/runs.js";
import { resolveWorkspace } from "./resolve/resolve.js";
import { NOTE_MAX, type RunEvent } from "./schema/index.js";

describe("examples/npm-login, the first real case", async () => {
  const workspace = await loadWorkspace(NPM_LOGIN_ROOT);
  const resolved = resolveWorkspace(workspace, { commitFor: () => null });
  const byId = new Map(resolved.cases.map((c) => [c.id, c]));

  it("loads and resolves with no errors", () => {
    expect(workspace.errors).toEqual([]);
    expect(resolved.errors).toEqual([]);
    expect(workspace.projects.map((p) => [p.name, p.path])).toEqual([
      [NPM_LOGIN_EXPECTED.project, "."],
    ]);
    expect([...byId.keys()].sort()).toEqual([...NPM_LOGIN_EXPECTED.caseIds]);
  });

  it("holds drafts only: automated where a run proves it, manual where an account is needed", () => {
    expect(resolved.cases.every((c) => c.state === "draft")).toBe(true);
    const automated = resolved.cases.filter((c) => c.automation.status === "automated");
    expect(automated.map((c) => c.id).sort()).toEqual([...NPM_LOGIN_EXPECTED.derivedAutomated]);
    for (const id of NPM_LOGIN_EXPECTED.manualNotEligible) {
      expect(byId.get(id)?.automation).toEqual({ eligible: false, status: "manual" });
    }
  });

  it("links every automated case to a test that exists in e2e/login.spec.ts", async () => {
    const spec = await readFile(join(NPM_LOGIN_ROOT, "e2e/login.spec.ts"), "utf8");
    for (const id of NPM_LOGIN_EXPECTED.derivedAutomated) {
      const ref = byId.get(id)?.automation.ref ?? "";
      const [file, title] = ref.split("::");
      expect(file).toBe("login.spec.ts");
      expect(spec).toContain(`test("${title}"`);
    }
  });

  it("keeps the latest result of the ingested run per case", () => {
    const [project] = workspace.projects;
    const latest = Object.fromEntries(
      (project?.runs ?? []).map(({ event }) => [event.case_id, event.status]),
    );
    expect(latest).toEqual(NPM_LOGIN_EXPECTED.lastRun);
  });

  const runs = async (ref: string) => {
    const registry = createRegistry();
    registry.register(runsOperation);
    const result = await registry.invoke("runs", { ref }, { root: NPM_LOGIN_ROOT, actor: "human" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.value as { ref: string; runs: (RunEvent & { path: string })[] };
  };

  it("lists each case's runs newest first, the noted re-ingest on top", async () => {
    for (const [id, count] of Object.entries(NPM_LOGIN_EXPECTED.runCount)) {
      const value = await runs(id);
      expect(value.ref).toBe(`${NPM_LOGIN_EXPECTED.project}/${id}`);
      expect(value.runs).toHaveLength(count);
      for (const run of value.runs) {
        expect(run).toMatchObject({ case_id: id, run_id: "local-2026-10-17-1" });
        expect(run.path).toBe("context/tests/.runs/local-2026-10-17-1.jsonl");
      }
      const [latest] = value.runs;
      if (latest !== undefined)
        expect(latest.status).toBe(NPM_LOGIN_EXPECTED.lastRun[id as "TC-0001"]);
    }
  });

  it("keeps why each failure failed: a bounded note and the page snapshot as evidence", async () => {
    for (const [id, text] of Object.entries(NPM_LOGIN_EXPECTED.failureNotes)) {
      const [latest, first] = (await runs(id)).runs;
      expect(latest?.status).toBe("failed");
      expect(latest?.note).toContain(text);
      expect(latest?.note?.length).toBeLessThanOrEqual(NOTE_MAX);
      expect(latest?.evidence).toEqual([
        {
          kind: "attachment",
          ref: NPM_LOGIN_EXPECTED.failureAttachments[
            id as keyof typeof NPM_LOGIN_EXPECTED.failureAttachments
          ],
        },
      ]);
      // The event ingested before #68 stays as it was (CONVENTIONS 5).
      expect(first?.note).toBeUndefined();
    }
  });
});
