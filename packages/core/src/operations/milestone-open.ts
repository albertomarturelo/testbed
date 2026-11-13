import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { fail, ok } from "../errors.js";
import { CommitInput, commitSubject } from "../git/subject.js";
import { MILESTONES_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { parseQuery } from "../query/parse.js";
import { CalendarDate, FileSafeId, Milestone } from "../schema/index.js";
import { WriteCommit, WriterInput, writeCommit, writtenBy } from "./case-file.js";
import { requireProject } from "./cases.js";
import { defineOperation } from "./operation.js";

const MilestoneOpenInput = z.strictObject({
  /** The file name and the name executions use: `web-2.1.0`, `sprint-23`. */
  slug: FileSafeId,
  title: Milestone.shape.title,
  due: CalendarDate.optional(),
  /** The version or Git tag the milestone certifies, when it is a release. */
  release: z.string().min(1).optional(),
  /** The cases it covers, as a query; default `state = active`. */
  scope: z.string().min(1).optional(),
  ...WriterInput,
  ...CommitInput,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const MilestoneOpenOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  path: z.string(),
  change: z.string(),
  commit: WriteCommit,
  next: z.array(z.string()),
});

/**
 * `casefile milestone open <slug> --title <t>` (ADR milestones-group-executions
 * §1–2): declares a milestone as `context/milestones/<slug>.yaml`, open, so
 * `run` and `ingest --milestone <slug>` can name it. Returns its commit.
 */
export const milestoneOpenOperation = defineOperation({
  name: "milestone-open",
  input: MilestoneOpenInput,
  output: MilestoneOpenOutput,
  actor: ["agent", "human"],
  writes: [`**/${MILESTONES_DIR}/*.yaml`],
  spec: "specs/milestone.md",
  subject: "slug",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const agentTrailer = workspace.config.commit?.agent_trailer !== false;
    const writer = writtenBy("milestone", context.actor, input, agentTrailer);
    if (!writer.ok) return writer;
    const { by, agent, asAgent } = writer.value;
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;

    const path = posix.join(project.path, MILESTONES_DIR, `${input.slug}.yaml`);
    if (project.milestones.has(input.slug) || (await context.exists(path))) {
      return fail({
        code: "milestone.exists",
        field: "slug",
        path,
        message: `${project.name} already has a milestone '${input.slug}': choose another slug`,
      });
    }
    if (input.scope !== undefined) {
      const parsed = parseQuery(input.scope);
      if (!parsed.ok) {
        return fail(
          ...parsed.errors.map((error) => ({
            ...error,
            code: "milestone.invalid_scope",
            field: "scope",
            message: `scope: ${error.message}`,
          })),
        );
      }
    }
    const subject = commitSubject(
      workspace.config.commit,
      { type: "test", scope: project.name, summary: `open milestone ${input.slug}` },
      input,
    );
    if (!subject.ok) return subject;

    const change = randomUUID();
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const file: Milestone = Milestone.parse({
      title: input.title,
      state: "open",
      ...(input.due === undefined ? {} : { due: input.due }),
      ...(input.release === undefined ? {} : { release: input.release }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      opened: { at, by, change },
    });
    await context.writeText(path, stringify(file, { lineWidth: 0 }));
    return ok({
      project: project.name,
      slug: input.slug,
      path,
      change,
      commit: writeCommit(
        subject.value,
        { requestedBy: by, inbox: input.inbox, agent, change },
        [path],
        asAgent,
      ),
      next: [
        asAgent
          ? "Commit the file with commit.author and commit.message taken from --json output, staging only it (`git commit -F <message> -- <path>`)"
          : "Commit the file with commit.message taken from --json output, as yourself, staging only it (`git commit -F <message> -- <path>`)",
        `Record executions in it: casefile run <ref> --status <status> --milestone ${input.slug}`,
      ],
    });
  },
});
