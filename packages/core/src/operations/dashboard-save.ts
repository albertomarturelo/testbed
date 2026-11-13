import { randomUUID } from "node:crypto";
import { stringify } from "yaml";
import { z } from "zod";
import { dashboardProblems } from "../dashboards/check.js";
import { fail, ok } from "../errors.js";
import { CommitInput, commitSubject } from "../git/subject.js";
import { DASHBOARDS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { Dashboard, FileSafeId } from "../schema/index.js";
import { WriteCommit, WriterInput, writeCommit, writtenBy } from "./case-file.js";
import { requireProject } from "./cases.js";
import { commitHint, dashboardPath } from "./dashboards.js";
import { defineOperation } from "./operation.js";

const DashboardSaveInput = z.strictObject({
  /** The file name and the name in the viewer's address: `overview`, `web-2.1.0`. */
  slug: FileSafeId,
  /** The whole dashboard: it replaces the file, it is not merged into it. */
  spec: Dashboard,
  ...WriterInput,
  ...CommitInput,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const DashboardSaveOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  path: z.string(),
  /** `true`: a new dashboard; `false`: it replaced the one the project had. */
  created: z.boolean(),
  widgets: z.number().int(),
  change: z.string(),
  commit: WriteCommit,
  next: z.array(z.string()),
});

/**
 * `casefile dashboard save <slug> --spec '<json>'` (ADR dashboards-as-files §4):
 * checks the whole dashboard and writes `context/dashboards/<slug>.yaml`, new
 * or replacing the file whole, all or nothing. Returns its commit.
 */
export const dashboardSaveOperation = defineOperation({
  name: "dashboard-save",
  input: DashboardSaveInput,
  output: DashboardSaveOutput,
  actor: ["agent", "human"],
  writes: [`**/${DASHBOARDS_DIR}/*.yaml`],
  spec: "specs/dashboard.md",
  subject: "slug",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const agentTrailer = workspace.config.commit?.agent_trailer !== false;
    const writer = writtenBy("dashboard", context.actor, input, agentTrailer);
    if (!writer.ok) return writer;
    const { by, agent, asAgent } = writer.value;
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;

    const problems = dashboardProblems(input.spec, project.milestones);
    if (problems.length > 0) {
      return fail(...problems.map((p) => ({ ...p, field: `spec.${p.field}` })));
    }
    const path = dashboardPath(project, input.slug);
    const text = stringify(input.spec, { lineWidth: 0 });
    const before = await context.readText(path);
    if (before === text) {
      return fail({
        code: "dashboard.no_change",
        field: "spec",
        path,
        message: `dashboard '${input.slug}' already is exactly this: nothing to save`,
      });
    }
    const created = before === null;
    const subject = commitSubject(
      workspace.config.commit,
      {
        type: "test",
        scope: project.name,
        summary: `${created ? "add" : "update"} dashboard ${input.slug}`,
      },
      input,
    );
    if (!subject.ok) return subject;

    const change = randomUUID();
    await context.writeText(path, text);
    return ok({
      project: project.name,
      slug: input.slug,
      path,
      created,
      widgets: input.spec.widgets.length,
      change,
      commit: writeCommit(
        subject.value,
        { requestedBy: by, inbox: input.inbox, agent, change, dashboard: input.slug },
        [path],
        asAgent,
      ),
      next: [commitHint(asAgent), `Check it: casefile dashboard list --project ${project.name}`],
    });
  },
});
