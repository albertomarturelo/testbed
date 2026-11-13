import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, ok } from "../errors.js";
import { CommitInput, commitSubject } from "../git/subject.js";
import { DASHBOARDS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { FileSafeId } from "../schema/index.js";
import { WriteCommit, WriterInput, writeCommit, writtenBy } from "./case-file.js";
import { requireProject } from "./cases.js";
import { commitHint, dashboardPath, unknownDashboard } from "./dashboards.js";
import { defineOperation } from "./operation.js";

const DashboardRemoveInput = z.strictObject({
  slug: FileSafeId,
  ...WriterInput,
  ...CommitInput,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const DashboardRemoveOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  /** The file that was deleted: the commit's pathspec. */
  path: z.string(),
  change: z.string(),
  commit: WriteCommit,
  next: z.array(z.string()),
});

/**
 * `casefile dashboard remove <slug>` (ADR dashboards-as-files §4): deletes
 * `context/dashboards/<slug>.yaml` and returns the commit of that deletion. A
 * file that does not load can be removed too: that is how a broken one goes.
 */
export const dashboardRemoveOperation = defineOperation({
  name: "dashboard-remove",
  input: DashboardRemoveInput,
  output: DashboardRemoveOutput,
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

    const path = dashboardPath(project, input.slug);
    if (!(await context.exists(path))) {
      return fail(unknownDashboard(project, input.slug));
    }
    const subject = commitSubject(
      workspace.config.commit,
      { type: "test", scope: project.name, summary: `remove dashboard ${input.slug}` },
      input,
    );
    if (!subject.ok) return subject;

    const change = randomUUID();
    await context.removeFile(path);
    return ok({
      project: project.name,
      slug: input.slug,
      path,
      change,
      commit: writeCommit(
        subject.value,
        { requestedBy: by, inbox: input.inbox, agent, change, dashboard: input.slug },
        [path],
        asAgent,
      ),
      next: [commitHint(asAgent)],
    });
  },
});
