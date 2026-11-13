import { describe, expect, it } from "vitest";
import { DEMO_EXPECTED, DEMO_ROOT } from "../demo.fixture.js";
import type { LoadedRun } from "../load/parse.js";
import { loadWorkspace } from "../load/workspace.js";
import { type ResolvedCase, resolveWorkspace } from "../resolve/resolve.js";
import type { Dashboard, RunEvent, Widget } from "../schema/index.js";
import { dashboardData, type WidgetData, type WidgetView, widgetData } from "./data.js";

const TODAY = "2026-11-13";

const demo = async (slug: keyof typeof DEMO_EXPECTED.dashboards) => {
  const workspace = await loadWorkspace(DEMO_ROOT);
  const [project] = workspace.projects;
  const dashboard = project?.dashboards.get(slug)?.file;
  if (project === undefined || dashboard === undefined) throw new Error(`no dashboard ${slug}`);
  const views = dashboardData({
    dashboard,
    cases: resolveWorkspace(workspace, { commitFor: () => null }).cases,
    runs: project.runs,
    milestones: project.milestones,
    today: TODAY,
  });
  return (id: string) => {
    const view = views.find((v) => v.id === id);
    if (view?.data === undefined) throw new Error(`no data for ${id}: ${view?.error?.message}`);
    return view.data;
  };
};

const counts = (data: WidgetData) =>
  data.type === "bar" || data.type === "donut"
    ? Object.fromEntries(data.groups.map((g) => [g.value, g.count]))
    : null;

describe("the demo's dashboards (DEMO_EXPECTED.dashboardData)", () => {
  it("overview: a count, two groupings and a table", async () => {
    const data = await demo("overview");
    const expected = DEMO_EXPECTED.dashboardData.overview;
    expect(data("total")).toEqual({ type: "stat", value: expected.total });
    expect(counts(data("by-state"))).toEqual(expected["by-state"]);
    expect(counts(data("by-feature"))).toEqual(expected["by-feature"]);
    // Largest group first, ties by value.
    expect(Object.keys(counts(data("by-feature")) ?? {})).toEqual(
      Object.keys(expected["by-feature"]),
    );
    const table = data("no-test");
    expect(table).toMatchObject({ columns: ["id", "title", "feature", "priority"], total: 2 });
    expect(table.type === "table" && table.rows.map((r) => r.id)).toEqual(expected["no-test"]);
  });

  it("web-1-2-0: latest results and executions inside the milestone", async () => {
    const data = await demo("web-1-2-0");
    const expected = DEMO_EXPECTED.dashboardData["web-1-2-0"];
    expect(counts(data("results"))).toEqual(expected.results);
    const table = data("failed");
    expect(
      table.type === "table" && Object.fromEntries(table.rows.map((r) => [r.id, r.cells.at(-1)])),
    ).toEqual(expected.failed);
    const series = data("executions");
    expect(
      series.type === "timeseries" && series.days.map((d) => [d.date, d.passed, d.failed]),
    ).toEqual(expected.executions);
  });
});

// Hand-made cases and events: only the fields a widget reads.
const kase = (id: string, fields: Record<string, unknown> = {}) =>
  ({
    id,
    project: "web",
    title: `Case ${id}`,
    state: "active",
    ...fields,
  }) as unknown as ResolvedCase;
const event = (case_id: string, status: RunEvent["status"], at: string, more = {}): LoadedRun => ({
  path: "context/tests/.runs/r.jsonl",
  line: 1,
  event: { run_id: "r", case_id, status, executor: "human:qa@acme.example", at, ...more },
});
const widget = (fields: Record<string, unknown>) =>
  ({ id: "w", title: "W", ...fields }) as unknown as Widget;
const compute = (w: Widget, cases: ResolvedCase[], runs: LoadedRun[] = []) => {
  const data = widgetData(w, { cases, runs, today: TODAY });
  if ("code" in data) throw new Error(data.message);
  return data;
};

describe("widgetData", () => {
  const cases = [
    kase("TC-0010", { priority: "P1", surfaces: ["web", "api"], labels: { risk: "payments" } }),
    kase("TC-0002", { priority: "P0", surfaces: ["web"], labels: {} }),
    kase("TC-0003", { priority: "P1", surfaces: [], labels: { smoke: true } }),
  ];

  it("groups a missing value under (none), last whatever its size", () => {
    const data = compute(widget({ type: "bar", group_by: "labels.risk" }), cases);
    expect(data).toEqual({
      type: "bar",
      groups: [
        { value: "payments", count: 1 },
        { value: "(none)", count: 2 },
      ],
      total: 3,
    });
  });

  it("counts a case once per item of a list, and booleans as text", () => {
    expect(counts(compute(widget({ type: "bar", group_by: "surfaces" }), cases))).toEqual({
      web: 2,
      api: 1,
      "(none)": 1,
    });
    expect(counts(compute(widget({ type: "donut", group_by: "labels.smoke" }), cases))).toEqual({
      true: 1,
      "(none)": 2,
    });
  });

  it("lists table rows by id up to the limit, with lists joined", () => {
    const data = compute(
      widget({ type: "table", columns: ["surfaces", "labels.risk"], limit: 2 }),
      cases,
    );
    expect(data).toEqual({
      type: "table",
      columns: ["id", "surfaces", "labels.risk"],
      rows: [
        { id: "TC-0002", cells: ["web", "(none)"] },
        { id: "TC-0003", cells: ["(none)", "(none)"] },
      ],
      total: 3,
    });
  });

  const runs = [
    event("TC-0002", "failed", "2026-11-10T09:00:00Z", { milestone: "m1" }),
    event("TC-0002", "passed", "2026-11-12T09:00:00Z", { milestone: "m1", build: "b7" }),
    event("TC-0002", "skipped", "2026-11-12T10:00:00Z", { milestone: "m1" }),
    event("TC-0003", "blocked", "2026-11-13T23:30:00-03:00", { milestone: "m2" }),
  ];

  it("reads last_result as the latest execution: a later skip hides nothing", () => {
    const data = compute(widget({ type: "donut", group_by: "last_result" }), cases, runs);
    expect(counts(data)).toEqual({ passed: 1, blocked: 1, not_run: 1 });
  });

  it("reads results and milestone.* inside the widget's milestone only", () => {
    const inM1 = widget({ type: "donut", group_by: "last_result", milestone: "m1" });
    expect(counts(compute(inM1, cases, runs))).toEqual({ passed: 1, not_run: 2 });
    const onBuild = widget({ type: "stat", milestone: "m1", query: "milestone.build = b7" });
    expect(compute(onBuild, cases, runs)).toEqual({ type: "stat", value: 3 });
  });

  it("counts every execution per UTC day, days without any included", () => {
    const data = compute(widget({ type: "timeseries", days: 4 }), cases, runs);
    expect(data).toEqual({
      type: "timeseries",
      days: [
        { date: "2026-11-10", passed: 0, failed: 1, blocked: 0, skipped: 0, not_run: 0 },
        { date: "2026-11-11", passed: 0, failed: 0, blocked: 0, skipped: 0, not_run: 0 },
        { date: "2026-11-12", passed: 1, failed: 0, blocked: 0, skipped: 1, not_run: 0 },
        { date: "2026-11-13", passed: 0, failed: 0, blocked: 0, skipped: 0, not_run: 0 },
      ],
      // 23:30 at -03:00 is the 14th in UTC: after the window.
      total: 3,
    });
  });

  it("covers 30 days by default, a milestone's own span, and nothing without executions", () => {
    const plain = compute(widget({ type: "timeseries" }), cases, runs);
    expect(plain.type === "timeseries" && [plain.days.length, plain.days[0]?.date]).toEqual([
      30,
      "2026-10-15",
    ]);
    const m1 = compute(widget({ type: "timeseries", milestone: "m1" }), cases, runs);
    expect(m1.type === "timeseries" && m1.days.map((d) => d.date)).toEqual([
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ]);
    const empty = compute(widget({ type: "timeseries", milestone: "m9" }), cases, runs);
    expect(empty).toEqual({ type: "timeseries", days: [], total: 0 });
  });

  it("counts only the matching cases' executions", () => {
    const data = compute(widget({ type: "timeseries", days: 4, query: "priority = P0" }), cases, [
      ...runs,
      event("TC-0010", "passed", "2026-11-12T09:00:00Z"),
    ]);
    expect(data.type === "timeseries" && data.total).toBe(3);
  });
});

describe("dashboardData", () => {
  const dashboard = {
    title: "D",
    widgets: [
      { id: "ok", title: "OK", type: "stat" },
      { id: "bad", title: "Bad", type: "stat", query: "state = = x", width: 6 },
      { id: "gone", title: "Gone", type: "donut", group_by: "state", milestone: "m9" },
    ],
  } as Dashboard;

  it("gives a broken widget an error and still computes the rest, with default widths", () => {
    const views = dashboardData({
      dashboard,
      cases: [kase("TC-0001")],
      runs: [],
      milestones: new Set<string>(),
      today: TODAY,
    });
    const shape = (v: WidgetView) => [v.id, v.width, v.data?.type ?? null, v.error?.code ?? null];
    expect(views.map(shape)).toEqual([
      ["ok", 3, "stat", null],
      ["bad", 6, null, "dashboard.invalid_query"],
      ["gone", 4, null, "dashboard.unknown_milestone"],
    ]);
  });
});
