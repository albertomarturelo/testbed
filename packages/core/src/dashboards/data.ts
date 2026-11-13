import type { CasefileError } from "../errors.js";
import { latestBuild, latestResults } from "../gates/evaluate.js";
import type { LoadedRun } from "../load/parse.js";
import { queryCases, readPath } from "../query/evaluate.js";
import type { ResolvedCase } from "../resolve/resolve.js";
import {
  type Dashboard,
  eventMilestone,
  LAST_RESULT,
  type RunEvent,
  type Widget,
} from "../schema/index.js";
import { dashboardProblems } from "./check.js";

// Pure (CONVENTIONS #3, #4): what each widget of a dashboard shows, from its
// project's resolved cases and run events (ADR dashboards-as-files §2, §5).
// Hosts draw this; none of them counts.

/** The group of cases with no value at `group_by`, and the cell of a missing value. */
export const NO_VALUE = "(none)";

/** `last_result` of a case with no execution. */
export const NOT_RUN = "not_run";

/** Columns of 12 a widget spans when it names no `width`. */
export const DEFAULT_WIDTH: Record<Widget["type"], number> = {
  stat: 3,
  donut: 4,
  bar: 6,
  table: 12,
  timeseries: 12,
};

/** Rows a `table` shows when it names no `limit`. */
export const DEFAULT_TABLE_LIMIT = 50;

/** Days a `timeseries` covers when it names neither `days` nor a milestone. */
export const DEFAULT_DAYS = 30;

/** The statuses a `timeseries` counts, in the order hosts stack them. */
export const SERIES_STATUSES = ["passed", "failed", "blocked", "skipped", "not_run"] as const;

export type SeriesDay = { date: string } & Record<(typeof SERIES_STATUSES)[number], number>;

export type WidgetData =
  | { type: "stat"; value: number }
  | {
      type: "bar" | "donut";
      /** Largest group first, then by value; `(none)` last. */
      groups: { value: string; count: number }[];
      /** The matching cases. A case with a list at `group_by` counts once per item. */
      total: number;
    }
  | {
      type: "table";
      /** `id` first, then the widget's columns. */
      columns: string[];
      rows: { id: string; cells: string[] }[];
      /** The matching cases; `rows` holds the first `limit` of them, by id. */
      total: number;
    }
  | {
      type: "timeseries";
      /** One entry per day from the first to the last, in UTC; empty without any day to show. */
      days: SeriesDay[];
      /** The executions counted. */
      total: number;
    };

export type WidgetView = {
  id: string;
  title: string;
  type: Widget["type"];
  /** The widget's `width`, or the default of its type. */
  width: number;
  /** What it shows; absent when `error` says why it cannot be computed. */
  data?: WidgetData;
  error?: { code: string; message: string };
};

export type DashboardInput = {
  dashboard: Dashboard;
  /** The project's resolved cases, in case order. */
  cases: readonly ResolvedCase[];
  /** The project's run events, in load order. */
  runs: readonly LoadedRun[];
  /** The project's declared milestones. */
  milestones: { has(slug: string): boolean };
  /** `YYYY-MM-DD` (UTC): the last day of a `timeseries` counted back in `days`. */
  today: string;
};

/**
 * Every widget of a dashboard with its data. Deterministic: the same files and
 * date give the same value. A widget `save` would refuse (a file edited by
 * hand, a milestone gone) carries an `error` and the others are still computed.
 */
export function dashboardData(input: DashboardInput): WidgetView[] {
  const problems = dashboardProblems(input.dashboard, input.milestones);
  return input.dashboard.widgets.map((widget, index): WidgetView => {
    const view = {
      id: widget.id,
      title: widget.title,
      type: widget.type,
      width: widget.width ?? DEFAULT_WIDTH[widget.type],
    };
    const problem = problems.find((p) => p.field?.startsWith(`widgets.${index}.`));
    if (problem !== undefined) return { ...view, error: asError(problem) };
    const data = widgetData(widget, input);
    return "code" in data ? { ...view, error: asError(data) } : { ...view, data };
  });
}

function asError(error: CasefileError): { code: string; message: string } {
  return { code: error.code, message: error.message };
}

/** One widget's data, or the error of a query that cannot run. */
export function widgetData(
  widget: Widget,
  input: Pick<DashboardInput, "cases" | "runs" | "today">,
): WidgetData | CasefileError {
  const slug = widget.milestone;
  const runs =
    slug === undefined ? input.runs : input.runs.filter((r) => eventMilestone(r.event) === slug);
  let cases = input.cases;
  if (widget.query !== undefined) {
    const build = latestBuild(runs);
    const values =
      slug === undefined ? undefined : build === null ? { name: slug } : { name: slug, build };
    const matched = queryCases(
      widget.query,
      input.cases,
      values === undefined ? {} : { milestone: values, release: values },
    );
    if (!matched.ok) {
      const [first] = matched.errors;
      return { code: "dashboard.invalid_query", message: first?.message ?? "the query cannot run" };
    }
    cases = matched.value;
  }
  const latest = latestResults(runs);
  const read = (c: ResolvedCase, path: string): unknown =>
    path === LAST_RESULT ? (latest.get(c.id)?.status ?? NOT_RUN) : readPath(c, path.split("."));

  switch (widget.type) {
    case "stat":
      return { type: "stat", value: cases.length };
    case "bar":
    case "donut": {
      const counts = new Map<string, number>();
      for (const c of cases) {
        for (const value of groupValues(read(c, widget.group_by))) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      const groups = [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort(
          (a, b) =>
            Number(a.value === NO_VALUE) - Number(b.value === NO_VALUE) ||
            b.count - a.count ||
            (a.value < b.value ? -1 : 1),
        );
      return { type: widget.type, groups, total: cases.length };
    }
    case "table":
      return {
        type: "table",
        columns: ["id", ...widget.columns],
        rows: byId(cases)
          .slice(0, widget.limit ?? DEFAULT_TABLE_LIMIT)
          .map((c) => ({
            id: c.id,
            cells: widget.columns.map((column) => groupValues(read(c, column)).join(", ")),
          })),
        total: cases.length,
      };
    case "timeseries": {
      const ids = new Set(cases.map((c) => c.id));
      const events = runs.map((r) => r.event).filter((e) => ids.has(e.case_id));
      return series(events, window(widget.days, slug !== undefined, events, input.today));
    }
  }
}

/** Cases by id, `TC-0002` before `TC-0010`. */
function byId(cases: readonly ResolvedCase[]): ResolvedCase[] {
  return [...cases].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** The values a case is counted under: a scalar as text, each item of a list, else `(none)`. */
function groupValues(value: unknown): string[] {
  const text = (v: unknown): string | null =>
    typeof v === "string" && v !== ""
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : null;
  if (Array.isArray(value)) {
    const items = value.map(text).filter((v): v is string => v !== null);
    return items.length === 0 ? [NO_VALUE] : [...new Set(items)];
  }
  return [text(value) ?? NO_VALUE];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (at: string): string => new Date(at).toISOString().slice(0, 10);

/**
 * The first and last day shown: `days` back from today when given; else the
 * span of the milestone's executions; else the default back from today.
 * `null`: a milestone without executions has no span.
 */
function window(
  days: number | undefined,
  inMilestone: boolean,
  events: readonly RunEvent[],
  today: string,
): { from: string; to: string } | null {
  if (days === undefined && inMilestone) {
    const dates = events.map((e) => utcDay(e.at)).sort();
    const [from] = dates;
    const to = dates.at(-1);
    return from === undefined || to === undefined ? null : { from, to };
  }
  const back = (days ?? DEFAULT_DAYS) - 1;
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - back * DAY_MS);
  return { from: from.toISOString().slice(0, 10), to: today };
}

function series(
  events: readonly RunEvent[],
  span: { from: string; to: string } | null,
): WidgetData {
  if (span === null) return { type: "timeseries", days: [], total: 0 };
  const days = new Map<string, SeriesDay>();
  for (
    let t = Date.parse(`${span.from}T00:00:00Z`);
    t <= Date.parse(`${span.to}T00:00:00Z`);
    t += DAY_MS
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.set(date, { date, passed: 0, failed: 0, blocked: 0, skipped: 0, not_run: 0 });
  }
  let total = 0;
  for (const event of events) {
    const day = days.get(utcDay(event.at));
    if (day === undefined) continue;
    day[event.status] += 1;
    total += 1;
  }
  return { type: "timeseries", days: [...days.values()], total };
}
