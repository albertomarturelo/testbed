import { z } from "zod";
import { ok } from "../errors.js";
import { loadWorkspaceCases, selectProject } from "./cases.js";
import { EvidenceTotalsOutput, milestoneDocument } from "./milestones.js";
import { defineOperation } from "./operation.js";

const MilestoneListInput = z.strictObject({
  /** Only this project; filled by the host. Absent: every project. */
  project: z.string().min(1).optional().meta({ host: "project" }),
  /** Only the open ones: what an execution may name. */
  open: z.boolean().optional(),
});

const MilestoneListOutput = z.strictObject({
  milestones: z.array(
    z.strictObject({
      project: z.string(),
      slug: z.string(),
      title: z.string(),
      state: z.enum(["open", "closed"]),
      due: z.string().nullable(),
      release: z.string().nullable(),
      /** The milestone file. */
      path: z.string(),
      closed: z.strictObject({ at: z.string(), by: z.string() }).nullable(),
      /**
       * Progress over the in-scope cases, from the files now while open and
       * from the frozen evidence once closed; `null` when it cannot be read
       * (a scope that does not parse, a frozen file gone): `milestone report`
       * says why.
       */
      totals: EvidenceTotalsOutput.nullable(),
      /** Gates red now (open) or at the close (closed); empty without a policy. */
      red_gates: z.array(z.string()),
    }),
  ),
});

/**
 * `casefile milestone list` (ADR milestones-group-executions §7): every
 * declared milestone with its progress, project by project: open ones first by
 * due date, then closed ones latest first, then by slug. What the viewer lists and an execution picks
 * from. Read-only.
 */
export const milestoneListOperation = defineOperation({
  name: "milestone-list",
  input: MilestoneListInput,
  output: MilestoneListOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/milestone.md",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const scope = selectProject(workspace, input.project);
    if (!scope.ok) return scope;
    const projects = workspace.projects.filter((p) => scope.value === null || p === scope.value);
    const today = new Date().toISOString().slice(0, 10);

    const milestones = [];
    for (const project of projects) {
      const declared = [...project.milestones.entries()]
        .filter(([, m]) => input.open !== true || m.file.state === "open")
        .sort(([a, x], [b, y]) => {
          const order = (m: typeof x) => (m.file.state === "open" ? 0 : 1);
          return (
            order(x) - order(y) ||
            // Open: the next due first. Closed: the latest closed first.
            (x.file.state === "open"
              ? (x.file.due ?? "9999").localeCompare(y.file.due ?? "9999")
              : (y.file.closed?.at ?? "").localeCompare(x.file.closed?.at ?? "")) ||
            a.localeCompare(b)
          );
        });
      for (const [slug, milestone] of declared) {
        const shown = await milestoneDocument(
          project,
          resolved.cases,
          slug,
          milestone,
          (file) => context.readText(file),
          today,
        );
        const document = shown.ok ? shown.value.document : null;
        const { file } = milestone;
        milestones.push({
          project: project.name,
          slug,
          title: file.title,
          state: file.state,
          due: file.due ?? null,
          release: file.release ?? null,
          path: milestone.path,
          closed: file.closed === undefined ? null : { at: file.closed.at, by: file.closed.by },
          totals: document?.totals ?? null,
          red_gates: shown.ok ? shown.value.red : [],
        });
      }
    }
    return ok({ milestones });
  },
});
