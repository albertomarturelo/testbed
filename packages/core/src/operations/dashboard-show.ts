import { z } from "zod";
import { dashboardData, SERIES_STATUSES } from "../dashboards/data.js";
import { fail, ok } from "../errors.js";
import { FileSafeId, WIDGET_TYPES } from "../schema/index.js";
import { loadWorkspaceCases, requireProject } from "./cases.js";
import { unknownDashboard } from "./dashboards.js";
import { defineOperation } from "./operation.js";

const DashboardShowInput = z.strictObject({
  /** The dashboard: `context/dashboards/<slug>.yaml`. */
  slug: FileSafeId,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const count = z.number().int();

/** `WidgetData` as the operation returns it. */
const WidgetDataOutput = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("stat"), value: count }),
  z.strictObject({
    type: z.enum(["bar", "donut"]),
    groups: z.array(z.strictObject({ value: z.string(), count })),
    total: count,
  }),
  z.strictObject({
    type: z.literal("table"),
    columns: z.array(z.string()),
    rows: z.array(z.strictObject({ id: z.string(), cells: z.array(z.string()) })),
    total: count,
  }),
  z.strictObject({
    type: z.literal("timeseries"),
    days: z.array(
      z.strictObject({
        date: z.string(),
        ...Object.fromEntries(SERIES_STATUSES.map((s) => [s, count])),
      } as { date: z.ZodString } & Record<(typeof SERIES_STATUSES)[number], typeof count>),
    ),
    total: count,
  }),
]);

const DashboardShowOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** The dashboard file. */
  path: z.string(),
  /** The day the numbers were computed on (UTC); a `timeseries` counted in days ends here. */
  date: z.string(),
  widgets: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      type: z.enum(WIDGET_TYPES),
      /** Columns of 12: the widget's `width`, or the default of its type. */
      width: count,
      /** What the widget shows; absent when `error` says why it cannot be computed. */
      data: WidgetDataOutput.optional(),
      error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
    }),
  ),
});

/**
 * `casefile dashboard show <slug>` (ADR dashboards-as-files §5): the dashboard
 * with the data of every widget, computed from the files now. What the viewer
 * draws and what an agent reads to answer with the same numbers. Read-only.
 */
export const dashboardShowOperation = defineOperation({
  name: "dashboard-show",
  input: DashboardShowInput,
  output: DashboardShowOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/dashboard.md",
  subject: "slug",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;
    const found = project.dashboards.get(input.slug);
    if (found === undefined) return fail(unknownDashboard(project, input.slug));

    const date = new Date().toISOString().slice(0, 10);
    return ok({
      project: project.name,
      slug: input.slug,
      title: found.file.title,
      description: found.file.description ?? null,
      path: found.path,
      date,
      widgets: dashboardData({
        dashboard: found.file,
        cases: resolved.cases.filter((c) => c.project === project.name),
        runs: project.runs,
        milestones: project.milestones,
        today: date,
      }),
    });
  },
});
