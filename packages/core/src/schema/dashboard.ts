import { z } from "zod";
import { FileSafeId } from "./primitives.js";

const OneLine = z
  .string()
  .min(1)
  .regex(/^[^\r\n]*$/, "one line");

/** A dotted path on the resolved case, as the query DSL reads it: `priority`, `labels.risk`. */
export const CasePath = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/, "a dotted path, e.g. labels.risk");

/** The one derived name a widget may group or list by: the case's latest execution. */
export const LAST_RESULT = "last_result";

/** Columns of the 12-column grid a widget spans. */
export const WidgetWidth = z.number().int().min(1).max(12);

// Key order is the order `dashboard save` writes: what a widget is, what it
// selects, how it shows it, how wide it is.
const head = {
  /** Unique in the dashboard; stable across saves, so a link to a widget survives. */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "a lowercase slug"),
  title: OneLine,
};
const selection = {
  /** The cases it counts, as a query (ADR single-query-dsl); absent: every case. */
  query: z.string().min(1).optional(),
  /** A declared milestone: results are read inside it and `milestone.*` is defined for `query`. */
  milestone: FileSafeId.optional(),
};
const tail = { width: WidgetWidth.optional() };

/** The number of matching cases. */
export const StatWidget = z.strictObject({
  ...head,
  type: z.literal("stat"),
  ...selection,
  ...tail,
});

const grouped = <T extends "bar" | "donut">(type: T) =>
  z.strictObject({
    ...head,
    type: z.literal(type),
    ...selection,
    /** Matching cases are counted per value of this path, or of `last_result`. */
    group_by: CasePath,
    ...tail,
  });

export const BarWidget = grouped("bar");
export const DonutWidget = grouped("donut");

/** The matching cases, one row each. */
export const TableWidget = z.strictObject({
  ...head,
  type: z.literal("table"),
  ...selection,
  /** Paths on the resolved case, or `last_result`; the case id always comes first. */
  columns: z.array(CasePath).min(1).max(8),
  limit: z.number().int().min(1).max(200).optional(),
  ...tail,
});

/** Executions of the matching cases per day, by status. */
export const TimeseriesWidget = z.strictObject({
  ...head,
  type: z.literal("timeseries"),
  ...selection,
  /** How many days back from today; default 30. With `milestone`: its span unless set. */
  days: z.number().int().min(1).max(365).optional(),
  ...tail,
});

export const Widget = z.discriminatedUnion("type", [
  StatWidget,
  BarWidget,
  DonutWidget,
  TableWidget,
  TimeseriesWidget,
]);
export type Widget = z.infer<typeof Widget>;

export const WIDGET_TYPES = ["stat", "bar", "donut", "table", "timeseries"] as const;

/**
 * `context/dashboards/<slug>.yaml` (ADR dashboards-as-files §1–3): widgets over
 * the project's cases and executions, in reading order on a 12-column grid.
 * Written whole by `dashboard save`; the slug is the file name.
 */
export const Dashboard = z.strictObject({
  title: OneLine,
  description: z.string().min(1).optional(),
  widgets: z.array(Widget).min(1).max(24),
});
export type Dashboard = z.infer<typeof Dashboard>;
