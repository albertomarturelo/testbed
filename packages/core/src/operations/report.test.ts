import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_EXPECTED,
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  DEMO_ROOT,
  NPM_LOGIN_EXPECTED,
  NPM_LOGIN_ROOT,
} from "../demo.fixture.js";
import { overviewOperation } from "./overview.js";
import { createRegistry } from "./registry.js";
import {
  compareTree,
  type ProjectReport,
  REPORT_LIMIT,
  renderReport,
  reportOperation,
} from "./report.js";

const registry = createRegistry();
registry.register(reportOperation);
registry.register(overviewOperation);

type Counts = Record<string, number | null> & { name: string };
type Report = {
  markdown: string;
  projects: Counts[];
  cases: { total: number; drafts: number; p0: number; failed: number };
  findings: { errors: number; warnings: number };
  left_out: number;
};

const report = async (root: string, input: Record<string, unknown> = {}) => {
  const result = await registry.invoke("report", input, { root, actor: "ci" });
  if (!result.ok) throw new Error(result.errors[0]?.message);
  return result.value as Report;
};

/** Refs `overview` gives a latest run of `failed`: the same rule, not re-derived. */
const failedRefs = async (root: string) => {
  const result = await registry.invoke("overview", {}, { root, actor: "agent" });
  if (!result.ok) throw new Error(result.errors[0]?.message);
  const rows = (result.value as { cases: { ref: string; last_run: string | null }[] }).cases;
  return rows.filter((row) => row.last_run === "failed").map((row) => row.ref);
};

const listed = (markdown: string, heading: string) => {
  const section = markdown.split(`### ${heading}`)[1]?.split("\n\n")[1] ?? "";
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
};

describe("report operation", () => {
  it("summarizes a workspace with runs: feature table, drafts, failed runs, validate", async () => {
    const value = await report(DEMO_ROOT);
    const [web] = value.projects;
    expect(web).toMatchObject({
      name: DEMO_EXPECTED.project,
      cases: DEMO_EXPECTED.caseIds.length,
      drafts: DEMO_EXPECTED.states.draft,
      automated: DEMO_EXPECTED.derivedAutomated.length,
    });
    const failed = await failedRefs(DEMO_ROOT);
    expect(web?.failed).toBe(failed.length);
    expect(value.cases).toMatchObject({
      total: DEMO_EXPECTED.caseIds.length,
      drafts: DEMO_EXPECTED.states.draft,
      failed: failed.length,
    });
    expect(value.findings).toEqual({ errors: 0, warnings: 0 });
    expect(value.left_out).toBe(0);

    const md = value.markdown;
    expect(md).toContain(
      "| Feature | Cases | Drafts | P0 | Automated | Linked | No test | Not eligible | Failed |",
    );
    // Tree order: one row per feature, parents before children, siblings by name.
    const features = [...md.matchAll(/^\| ([a-z/]+) \|/gm)].map((m) => m[1]);
    expect(features).toEqual([...features].sort());
    for (const top of DEMO_EXPECTED.topLevelFeatures) {
      expect(features.some((f) => f?.startsWith(`${top}/`))).toBe(true);
    }
    expect(md).toContain("| **Total** | 8 |");
    expect(listed(md, "Drafts awaiting review")).toHaveLength(DEMO_EXPECTED.states.draft);
    expect(listed(md, "Latest run failed")).toEqual(failed);
    expect(md.trimEnd().endsWith("`casefile validate`: 0 errors, 0 warnings.")).toBe(true);
  });

  it("counts automation as the viewer does and lists every draft (npm-login)", async () => {
    const value = await report(NPM_LOGIN_ROOT);
    expect(value.projects[0]).toMatchObject({
      name: NPM_LOGIN_EXPECTED.project,
      drafts: NPM_LOGIN_EXPECTED.states.draft,
      automated: NPM_LOGIN_EXPECTED.derivedAutomated.length,
      not_eligible: NPM_LOGIN_EXPECTED.manualNotEligible.length,
    });
    expect(listed(value.markdown, "Drafts awaiting review")).toEqual(
      NPM_LOGIN_EXPECTED.caseIds.map((id) => `${NPM_LOGIN_EXPECTED.project}/${id}`),
    );
  });

  describe("without run events", () => {
    let tmp = "";
    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), "casefile-report-"));
      await cp(DEMO_ROOT, tmp, { recursive: true });
      await rm(join(tmp, "context/tests/.runs"), { recursive: true, force: true });
    });
    afterEach(() => rm(tmp, { recursive: true, force: true }));

    it("leaves out the run columns and the failed list", async () => {
      const value = await report(tmp);
      expect(value.projects[0]?.failed).toBeNull();
      expect(value.projects[0]?.automated).toBe(0);
      expect(value.markdown).toContain(
        "| Feature | Cases | Drafts | P0 | Linked | No test | Not eligible |",
      );
      expect(value.markdown).not.toMatch(/Automated|Failed|Latest run failed|never ran/);
      expect(listed(value.markdown, "Drafts awaiting review")).toHaveLength(
        DEMO_EXPECTED.states.draft,
      );
    });
  });

  it("keeps only the cases a query selects", async () => {
    const query = "labels.risk = payments AND automation.status != automated";
    const value = await report(DEMO_ROOT, { query });
    expect(value.cases.total).toBe(DEMO_EXPECTED.queries[query].length);
    expect(value.markdown).toContain(`Cases matching \`${query}\`.`);

    const drafts = await report(DEMO_ROOT, { query: "state = draft" });
    expect(drafts.cases).toMatchObject({ total: DEMO_EXPECTED.states.draft, failed: 0 });
  });

  it("says a project has no cases instead of drawing an empty table", async () => {
    const value = await report(DEMO_ROOT, { query: "state = nonexistent" });
    expect(value.cases.total).toBe(0);
    expect(value.markdown).toContain(`## ${DEMO_EXPECTED.project}\n\nNo cases.\n`);
    expect(value.markdown).not.toContain("| Feature |");
  });

  it("points at the query when it does not parse", async () => {
    const result = await registry.invoke(
      "report",
      { query: "state =" },
      { root: DEMO_ROOT, actor: "ci" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe("query");
  });

  it("reports every project in casefile.yaml order, or the one asked for", async () => {
    const all = await report(DEMO_MONOREPO_ROOT);
    expect(all.projects.map((p) => p.name)).toEqual(Object.keys(DEMO_MONOREPO_EXPECTED.projects));
    expect(all.cases.total).toBe(DEMO_MONOREPO_EXPECTED.caseRefs.length);

    const api = await report(DEMO_MONOREPO_ROOT, { project: "api" });
    expect(api.projects.map((p) => p.name)).toEqual(["api"]);
    expect(api.markdown).not.toContain("## web");

    const unknown = await registry.invoke(
      "report",
      { project: "nope" },
      { root: DEMO_MONOREPO_ROOT, actor: "ci" },
    );
    expect(unknown.ok ? "" : unknown.errors[0]?.code).toBe("project.unknown");
  });
});

describe("renderReport size cut", () => {
  const counts = {
    cases: 1,
    drafts: 1,
    p0: 0,
    automated: 0,
    linked: 0,
    no_test: 1,
    not_eligible: 0,
    failed: 0,
  };
  const project = (drafts: number): ProjectReport => ({
    name: "web",
    path: ".",
    hasRuns: false,
    features: [{ feature: "login", ...counts, drafts, cases: drafts }],
    total: { ...counts, drafts, cases: drafts },
    drafts: Array.from({ length: drafts }, (_, i) => ({
      ref: `web/TC-${String(i + 1).padStart(4, "0")}`,
      title: `Draft number ${i + 1} with a title long enough to fill a line of the report`,
    })),
    failed: [],
  });
  const findings = { errors: 0, warnings: 2 };

  it("keeps everything when it fits", () => {
    const { markdown, left_out } = renderReport({ projects: [project(3)], findings }, 2_000);
    expect(left_out).toBe(0);
    expect(markdown).not.toContain("not shown");
  });

  it("cuts long lists in reading order and says how many were left out", () => {
    const limit = 2_000;
    const { markdown, left_out } = renderReport({ projects: [project(100)], findings }, limit);
    expect(markdown.length).toBeLessThanOrEqual(limit);
    const kept = listed(markdown, "Drafts awaiting review (100)");
    expect(kept[0]).toBe("web/TC-0001");
    expect(kept.length + left_out).toBe(100);
    expect(markdown).toContain(`- _${left_out} more not shown_`);
    // The closing line always stays.
    expect(markdown.trimEnd().endsWith("0 errors, 2 warnings.")).toBe(true);
  });

  it("stays under a PR comment's 65,536 characters by default", () => {
    const { markdown, left_out } = renderReport({ projects: [project(5_000)], findings });
    expect(markdown.length).toBeLessThanOrEqual(REPORT_LIMIT);
    expect(left_out).toBeGreaterThan(0);
  });
});

describe("compareTree", () => {
  it("puts parents before children and orders siblings by name, segment by segment", () => {
    // A plain string sort would put `auth-legacy` before `auth/login` ('-' < '/').
    const features = ["checkout/payments", "auth-legacy", "auth/login", "checkout", "auth"];
    expect([...features].sort(compareTree)).toEqual([
      "auth",
      "auth/login",
      "auth-legacy",
      "checkout",
      "checkout/payments",
    ]);
  });
});
