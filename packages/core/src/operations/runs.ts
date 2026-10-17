import { z } from "zod";
import { fail, ok } from "../errors.js";
import { loadWorkspace } from "../load/workspace.js";
import { RunEvent } from "../schema/index.js";
import { CaseRef, findCase } from "./cases.js";
import { defineOperation } from "./operation.js";

const RunsInput = z.strictObject({
  /** The case: a bare id in the current project, or `<project>/TC-NNNN`. */
  ref: CaseRef,
  /** Where a bare id is looked up; filled by the host. Absent: every project. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const RunsOutput = z.strictObject({
  /** Always qualified: `web/TC-0003`. */
  ref: z.string(),
  /** The case's run events, newest first; each with the run file it is a line of. */
  runs: z.array(RunEvent.extend({ path: z.string() })),
});

/**
 * `casefile runs <ref>`: every run event of one case in its project's `.runs/`,
 * newest first, with its note and evidence (ADR run-event-note §7). Read-only.
 * Unlike `resolve`, a case that does not resolve still lists its runs.
 */
export const runsOperation = defineOperation({
  name: "runs",
  input: RunsInput,
  output: RunsOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/runs.md",
  subject: "ref",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const target = findCase(workspace, input.ref, input.project);
    if (!target.ok) return target;
    const { project, case: found } = target.value;

    // Newest `at` first; on a tie, the later line first, as `overview` picks the latest.
    const runs = project.runs
      .map((run, order) => ({ run, order }))
      .filter(({ run }) => run.event.case_id === found.file.id)
      .sort((a, b) => Date.parse(b.run.event.at) - Date.parse(a.run.event.at) || b.order - a.order)
      .map(({ run }) => ({ ...run.event, path: run.path }));
    return ok({ ref: `${project.name}/${found.file.id}`, runs });
  },
});
