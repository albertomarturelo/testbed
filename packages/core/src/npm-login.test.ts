import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NPM_LOGIN_EXPECTED, NPM_LOGIN_ROOT } from "./demo.fixture.js";
import { loadWorkspace } from "./load/workspace.js";
import { resolveWorkspace } from "./resolve/resolve.js";

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
});
