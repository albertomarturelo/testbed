import { randomUUID } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";
import { fail, ok } from "../errors.js";
import { CommitInput, commitSubject } from "../git/subject.js";
import { MILESTONES_DIR } from "../load/paths.js";
import { redGates, renderEvidence } from "../milestones/evidence.js";
import { FileSafeId, Milestone } from "../schema/index.js";
import { WriteCommit, WriterInput, writeCommit, writtenBy } from "./case-file.js";
import { loadWorkspaceCases, requireProject } from "./cases.js";
import { evidencePath, findMilestone, projectEvidence } from "./milestones.js";
import { defineOperation } from "./operation.js";

const MilestoneCloseInput = z.strictObject({
  /** The open milestone to close: `context/milestones/<slug>.yaml`. */
  slug: FileSafeId,
  /** Written into the evidence; required while a gate is red (why it is accepted). */
  note: z.string().min(1).optional(),
  ...WriterInput,
  ...CommitInput,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const MilestoneCloseOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  /** The frozen evidence, `context/milestones/<slug>/evidence.md`. */
  evidence: z.string(),
  /** The milestone file, now `state: closed`. */
  path: z.string(),
  change: z.string(),
  red_gates: z.array(z.string()),
  commit: WriteCommit,
  next: z.array(z.string()),
});

/**
 * `casefile milestone close <slug> [--note <text>]` (ADR milestones-group-executions
 * §2, §4, §5): writes the milestone's evidence from the run files and sets
 * `state: closed` with who closed it, both in one commit carrying
 * `Casefile-Milestone: <slug>`. Red gates do not block, but need a note.
 */
export const milestoneCloseOperation = defineOperation({
  name: "milestone-close",
  input: MilestoneCloseInput,
  output: MilestoneCloseOutput,
  actor: ["agent", "human"],
  writes: [`**/${MILESTONES_DIR}/*.yaml`, `**/${MILESTONES_DIR}/*/evidence.md`],
  spec: "specs/milestone.md",
  subject: "slug",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const config = workspace.config;
    const agentTrailer = config?.commit?.agent_trailer !== false;
    const writer = writtenBy("milestone", context.actor, input, agentTrailer);
    if (!writer.ok) return writer;
    const { by, agent, asAgent } = writer.value;
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;
    const milestone = findMilestone(project, input.slug);
    if (!milestone.ok) return milestone;
    if (milestone.value.file.state === "closed") {
      return fail({
        code: "milestone.closed",
        field: "slug",
        path: milestone.value.path,
        message: `milestone '${input.slug}' is already closed: its evidence is frozen; a correction is a new milestone`,
      });
    }

    const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const evidence = projectEvidence(project, resolved.cases, input.slug, milestone.value, {
      closed: { at, by },
      ...(input.note === undefined ? {} : { note: input.note }),
      today: at.slice(0, 10),
    });
    if (!evidence.ok) return evidence;
    const red = redGates(evidence.value);
    if (red.length > 0 && input.note === undefined) {
      return fail({
        code: "milestone.red_gates",
        field: "note",
        message: `gates are red (${red.join(", ")}): record the missing results, or close with --note saying why they are accepted`,
      });
    }
    const subject = commitSubject(
      config?.commit,
      { type: "test", scope: project.name, summary: `close milestone ${input.slug}` },
      input,
    );
    if (!subject.ok) return subject;

    // Edit the stored document, so comments and key order the human wrote survive.
    const change = randomUUID();
    const text = (await context.readText(milestone.value.path)) ?? "";
    const document = parseDocument(text);
    document.set("state", "closed");
    document.set("closed", { at, by, change });
    Milestone.parse(document.toJS());

    const path = evidencePath(project, input.slug);
    await context.writeText(path, renderEvidence(evidence.value));
    await context.writeText(milestone.value.path, document.toString({ lineWidth: 0 }));
    const release = milestone.value.file.release;
    return ok({
      project: project.name,
      slug: input.slug,
      evidence: path,
      path: milestone.value.path,
      change,
      red_gates: red,
      commit: writeCommit(
        subject.value,
        { requestedBy: by, inbox: input.inbox, agent, change, milestone: input.slug },
        [path, milestone.value.path],
        asAgent,
      ),
      next: [
        asAgent
          ? "Commit both files with commit.author and commit.message taken from --json output, staging only them (`git commit -F <message> -- <paths>`)"
          : "Commit both files with commit.message taken from --json output, as yourself, staging only them (`git commit -F <message> -- <paths>`); a repository that signs commits signs this one",
        ...(release === undefined
          ? []
          : [`Attach the evidence to the GitHub release: gh release upload ${release} ${path}`]),
      ],
    });
  },
});
