// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DashboardRow, type DashboardShown, forgetSession, type Result } from "@/api";
import { formatRoute, parseRoute } from "@/route";
import { ASK_THE_AGENT, DashboardPage, Dashboards, shortLabel } from "@/views/Dashboards";

/** What the fake API answers, per operation; inputs are recorded in `calls`. */
let answers: Record<string, (input: Record<string, unknown>) => Result<unknown>> = {};
const calls: { name: string; input: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = { session: () => ({ ok: true, value: { token: "t", identity: null } }) };
  forgetSession();
  vi.stubGlobal("fetch", async (url: string, init?: { body: string }) => {
    const name = url.split("/").at(-1) as string;
    const input = init === undefined ? {} : (JSON.parse(init.body) as Record<string, unknown>);
    if (init !== undefined) calls.push({ name, input });
    const answer = answers[name]?.(input) ?? { ok: false, errors: [{ code: "x", message: name }] };
    return new Response(JSON.stringify(answer));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const callsOf = (name: string) => calls.filter((c) => c.name === name).map((c) => c.input);

const row = (over: Partial<DashboardRow> = {}): DashboardRow => ({
  project: "web",
  slug: "overview",
  title: "Overview",
  description: "Where the cases are.",
  widgets: 4,
  path: "context/dashboards/overview.yaml",
  ...over,
});

const day = (date: string, over: Partial<Record<string, number>> = {}) => ({
  date,
  passed: 0,
  failed: 0,
  blocked: 0,
  skipped: 0,
  not_run: 0,
  ...over,
});

const shown = (widgets: DashboardShown["widgets"]): DashboardShown => ({
  project: "web",
  slug: "overview",
  title: "Overview",
  description: "Where the cases are.",
  path: "context/dashboards/overview.yaml",
  date: "2026-11-13",
  widgets,
});

const widget = (title: string) => screen.getByRole("region", { name: title });

describe("routes", () => {
  it("round-trips the dashboards list and one dashboard", () => {
    for (const route of [
      { view: "dashboards" },
      { view: "dashboards", project: "web" },
      { view: "dashboard", project: "web", slug: "overview" },
    ] as const) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
    expect(formatRoute({ view: "dashboard", project: "web", slug: "web-1-2-0" })).toBe(
      "#/dashboard/web/web-1-2-0",
    );
    // A dashboard has no sub-page: anything after the slug is not one.
    expect(parseRoute("#/dashboard/web/overview/extra").view).toBe("cases");
  });
});

describe("shortLabel", () => {
  it("keeps a short value and the specific end of a long one", () => {
    expect(shortLabel("auth/login")).toBe("auth/login");
    const long = "checkout/payments/saved-cards/three-d-secure";
    expect(shortLabel(long)).toBe(`…${long.slice(-25)}`);
    expect(shortLabel(long)).toHaveLength(26);
  });
});

describe("Dashboards", () => {
  it("lists each dashboard with its widget count, naming the project when there are several", async () => {
    answers["dashboard-list"] = () => ({
      ok: true,
      value: {
        dashboards: [
          row(),
          row({ project: "api", slug: "api-health", title: "API health", description: null }),
        ],
      },
    });
    render(<Dashboards projects={["web", "api"]} version={0} />);
    const link = await screen.findByRole("link", { name: /Overview/ });
    expect(link.getAttribute("href")).toBe("#/dashboard/web/overview");
    expect(screen.getByRole("link", { name: /API health/ }).getAttribute("href")).toBe(
      "#/dashboard/api/api-health",
    );
    expect(screen.getByRole("columnheader", { name: "Project" })).toBeTruthy();
    expect(callsOf("dashboard-list")).toEqual([{}]);
  });

  it("asks for one project's dashboards", async () => {
    answers["dashboard-list"] = () => ({ ok: true, value: { dashboards: [row()] } });
    render(<Dashboards project="web" projects={["web", "api"]} version={0} />);
    await screen.findByRole("link", { name: /Overview/ });
    expect(screen.queryByRole("columnheader", { name: "Project" })).toBeNull();
    expect(callsOf("dashboard-list")).toEqual([{ project: "web" }]);
  });

  it("tells the QA to ask the agent when there is none", async () => {
    answers["dashboard-list"] = () => ({ ok: true, value: { dashboards: [] } });
    render(<Dashboards projects={["web"]} version={0} />);
    expect(await screen.findByText("No dashboards yet.")).toBeTruthy();
    expect(screen.getByText(new RegExp(ASK_THE_AGENT))).toBeTruthy();
  });
});

describe("DashboardPage", () => {
  it("lays the widgets out by width on 12 columns, in file order", async () => {
    answers["dashboard-show"] = () => ({
      ok: true,
      value: shown([
        { id: "total", title: "Cases", type: "stat", width: 3, data: { type: "stat", value: 42 } },
        {
          id: "by-feature",
          title: "Per feature",
          type: "bar",
          width: 9,
          data: { type: "bar", groups: [{ value: "auth", count: 5 }], total: 5 },
        },
      ]),
    });
    render(<DashboardPage project="web" slug="overview" version={0} />);
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(callsOf("dashboard-show")).toEqual([{ project: "web", slug: "overview" }]);
    const regions = [...document.querySelectorAll<HTMLElement>("[data-widget]")];
    expect(regions.map((r) => r.dataset.widget)).toEqual(["total", "by-feature"]);
    // One column on a narrow screen, the widget's width from `lg` up.
    expect(regions[0]?.classList.contains("lg:col-span-3")).toBe(true);
    expect(regions[1]?.classList.contains("lg:col-span-9")).toBe(true);
    expect(regions[0]?.parentElement?.className).toMatch(/grid-cols-1 .*lg:grid-cols-12/);
    expect(within(widget("Cases")).getByText("42")).toBeTruthy();
    expect(screen.getByText(/2026-11-13 \(UTC\)/)).toBeTruthy();
  });

  it("shows a widget's error in its place and draws the others", async () => {
    answers["dashboard-show"] = () => ({
      ok: true,
      value: shown([
        {
          id: "broken",
          title: "Broken",
          type: "stat",
          width: 3,
          error: { code: "dashboard.invalid_query", message: "unexpected token at 7" },
        },
        { id: "ok", title: "Fine", type: "stat", width: 3, data: { type: "stat", value: 1 } },
      ]),
    });
    render(<DashboardPage project="web" slug="overview" version={0} />);
    const broken = await screen.findByRole("region", { name: "Broken" });
    expect(within(broken).getByRole("alert").textContent).toMatch(
      /dashboard\.invalid_query.*unexpected token at 7/,
    );
    expect(within(widget("Fine")).getByText("1")).toBeTruthy();
  });

  it("says why a dashboard cannot be shown", async () => {
    answers["dashboard-show"] = () => ({
      ok: false,
      errors: [{ code: "dashboard.unknown", message: "no dashboard nope in web" }],
    });
    render(<DashboardPage project="web" slug="nope" version={0} />);
    expect(await screen.findByText(/no dashboard nope in web/)).toBeTruthy();
  });

  it("names every chart and gives its values as text, without hover", async () => {
    answers["dashboard-show"] = () => ({
      ok: true,
      value: shown([
        {
          id: "results",
          title: "Latest result",
          type: "donut",
          width: 4,
          data: {
            type: "donut",
            groups: [
              { value: "passed", count: 3 },
              { value: "not_run", count: 2 },
              { value: "failed", count: 1 },
            ],
            total: 6,
          },
        },
        {
          id: "by-feature",
          title: "Per feature",
          type: "bar",
          width: 8,
          data: {
            type: "bar",
            groups: [
              { value: "auth/login", count: 4 },
              { value: "(none)", count: 1 },
            ],
            total: 5,
          },
        },
      ]),
    });
    render(<DashboardPage project="web" slug="overview" version={0} />);
    const donut = await screen.findByRole("img", { name: /^Latest result:/ });
    expect(donut.getAttribute("aria-label")).toBe("Latest result: passed 3, not run 2, failed 1");
    const legend = within(widget("Latest result"));
    expect(legend.getByText("not run")).toBeTruthy();
    expect(legend.getByText("6 matching cases")).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Per feature:/ }).getAttribute("aria-label")).toBe(
      "Per feature: auth/login 4, (none) 1",
    );
  });

  it("keeps file values out of the chart's CSS: series are keyed g0, g1…", async () => {
    answers["dashboard-show"] = () => ({
      ok: true,
      value: shown([
        {
          id: "labels",
          title: "By label",
          type: "donut",
          width: 4,
          data: { type: "donut", groups: [{ value: "x;}body{color:red", count: 1 }], total: 1 },
        },
      ]),
    });
    const { container } = render(<DashboardPage project="web" slug="overview" version={0} />);
    await screen.findByRole("img", { name: /^By label:/ });
    const css = [...container.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toContain("--color-g0");
    expect(css).not.toContain("body{color:red");
  });

  it("lists a table's cases, each id opening the case, and says when it is cut", async () => {
    answers["dashboard-show"] = () => ({
      ok: true,
      value: shown([
        {
          id: "no-test",
          title: "No test yet",
          type: "table",
          width: 12,
          data: {
            type: "table",
            columns: ["id", "title", "last_result"],
            rows: [{ id: "TC-0001", cells: ["Sign in", "not_run"] }],
            total: 3,
          },
        },
      ]),
    });
    render(<DashboardPage project="web" slug="overview" version={0} />);
    const table = within(await screen.findByRole("region", { name: "No test yet" }));
    expect(table.getByRole("link", { name: "TC-0001" }).getAttribute("href")).toBe(
      "#/case/web/TC-0001",
    );
    expect(table.getByRole("columnheader", { name: "last_result" })).toBeTruthy();
    expect(table.getByText("not run")).toBeTruthy();
    expect(table.getByText("The first 1 of 3 matching cases")).toBeTruthy();
  });

  it("gives a timeseries' totals and per-day values as text", async () => {
    answers["dashboard-show"] = () => ({
      ok: true,
      value: shown([
        {
          id: "executions",
          title: "Executions per day",
          type: "timeseries",
          width: 12,
          data: {
            type: "timeseries",
            days: [
              day("2026-11-01", { passed: 2, failed: 1 }),
              day("2026-11-02"),
              day("2026-11-03", { blocked: 1 }),
            ],
            total: 4,
          },
        },
      ]),
    });
    render(<DashboardPage project="web" slug="overview" version={0} />);
    const chart = await screen.findByRole("img", { name: /^Executions per day/ });
    expect(chart.getAttribute("aria-label")).toBe(
      "Executions per day, 2026-11-01 to 2026-11-03: 2026-11-01: 2 passed, 1 failed, 2026-11-03: 1 blocked",
    );
    const box = within(widget("Executions per day"));
    expect(box.getByText("4 executions from 2026-11-01 to 2026-11-03")).toBeTruthy();
    expect(box.getByText(/2 days with any/)).toBeTruthy();
    expect(box.getByRole("cell", { name: "2026-11-03" })).toBeTruthy();
    expect(box.queryByRole("cell", { name: "2026-11-02" })).toBeNull();
  });

  it("says when a timeseries has nothing to draw", async () => {
    answers["dashboard-show"] = () => ({
      ok: true,
      value: shown([
        {
          id: "m",
          title: "In the milestone",
          type: "timeseries",
          width: 12,
          data: { type: "timeseries", days: [], total: 0 },
        },
        {
          id: "d",
          title: "Last days",
          type: "timeseries",
          width: 12,
          data: { type: "timeseries", days: [day("2026-11-12"), day("2026-11-13")], total: 0 },
        },
      ]),
    });
    render(<DashboardPage project="web" slug="overview" version={0} />);
    expect(await screen.findByText("No executions in the milestone yet.")).toBeTruthy();
    expect(screen.getByText("No executions in these 2 days.")).toBeTruthy();
  });
});
