import { z } from "zod";
import { fail, ok } from "../errors.js";
import { FileSafeId } from "../schema/index.js";
import { loadWorkspaceCases, requireProject } from "./cases.js";
import {
  EvidenceDocumentOutput,
  evidencePath,
  findMilestone,
  milestoneDocument,
} from "./milestones.js";
import { defineOperation } from "./operation.js";

const MilestoneReportInput = z.strictObject({
  /** The milestone: `context/milestones/<slug>.yaml`. */
  slug: FileSafeId,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const MilestoneReportOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  state: z.enum(["open", "closed"]),
  /** Where `close` writes the evidence, or wrote it. */
  path: z.string(),
  /** The evidence as Markdown: generated now while open, the frozen file once closed. */
  evidence: z.string(),
  /**
   * The same evidence as data, for a page to show and print. Once closed it is
   * read from the frozen file; absent when that file no longer has the shape
   * core writes (edited by hand): show `evidence` as it is.
   */
  report: EvidenceDocumentOutput.optional(),
  /** Open only: the gates that are red now; `close` needs `--note` while any is. */
  red_gates: z.array(z.string()).optional(),
  next: z.array(z.string()),
});

/**
 * `casefile milestone report <slug>` (ADR milestones-group-executions §4): the
 * evidence `close` would write, generated from the run files now; once closed,
 * the evidence it froze. Writes nothing.
 */
export const milestoneReportOperation = defineOperation({
  name: "milestone-report",
  input: MilestoneReportInput,
  output: MilestoneReportOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/milestone.md",
  subject: "slug",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;
    const milestone = findMilestone(project, input.slug);
    if (!milestone.ok) return milestone;
    const path = evidencePath(project, input.slug);
    const today = new Date().toISOString().slice(0, 10);
    const shown = await milestoneDocument(
      project,
      resolved.cases,
      input.slug,
      milestone.value,
      (file) => context.readText(file),
      today,
    );
    if (!shown.ok) return shown;
    const { document, red, markdown } = shown.value;

    if (shown.value.state === "closed") {
      if (markdown === null) {
        return fail({
          code: "milestone.evidence_missing",
          field: "slug",
          path,
          message: `milestone '${input.slug}' is closed but its evidence file is missing: restore it from Git history`,
        });
      }
      return ok({
        project: project.name,
        slug: input.slug,
        state: "closed" as const,
        path,
        evidence: markdown,
        ...(document === null ? {} : { report: document }),
        next: [],
      });
    }

    return ok({
      project: project.name,
      slug: input.slug,
      state: "open" as const,
      path,
      evidence: markdown ?? "",
      ...(document === null ? {} : { report: document }),
      red_gates: red,
      next: [
        red.length === 0
          ? `Freeze it: casefile milestone close ${input.slug}`
          : `Gates are red (${red.join(", ")}): record the missing results, or close with a note saying why they are accepted: casefile milestone close ${input.slug} --note '<why>'`,
      ],
    });
  },
});
