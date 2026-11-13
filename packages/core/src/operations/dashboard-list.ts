import { z } from "zod";
import { fail, ok } from "../errors.js";
import { loadWorkspace } from "../load/workspace.js";
import { selectProject } from "./cases.js";
import { defineOperation } from "./operation.js";

const DashboardListInput = z.strictObject({
  /** Only this project; filled by the host. Absent: every project. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const DashboardListOutput = z.strictObject({
  dashboards: z.array(
    z.strictObject({
      project: z.string(),
      slug: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      /** How many widgets it has. */
      widgets: z.number().int(),
      /** The dashboard file. */
      path: z.string(),
    }),
  ),
});

/**
 * `casefile dashboard list` (ADR dashboards-as-files §4): every dashboard that
 * loads, project by project in `casefile.yaml` order, then by slug. A file
 * that does not load is `casefile validate`'s to report. Read-only.
 */
export const dashboardListOperation = defineOperation({
  name: "dashboard-list",
  input: DashboardListInput,
  output: DashboardListOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/dashboard.md",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const scope = selectProject(workspace, input.project);
    if (!scope.ok) return scope;
    const projects = workspace.projects.filter((p) => scope.value === null || p === scope.value);
    return ok({
      dashboards: projects.flatMap((project) =>
        [...project.dashboards.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([slug, { path, file }]) => ({
            project: project.name,
            slug,
            title: file.title,
            description: file.description ?? null,
            widgets: file.widgets.length,
            path,
          })),
      ),
    });
  },
});
