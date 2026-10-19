import { z } from "zod";
import { ok } from "../errors.js";
import type { LoadedProject } from "../load/workspace.js";
import { caseRef } from "../resolve/resolve.js";
import type { RunEvent } from "../schema/index.js";
import { loadWorkspaceCases, selectProject } from "./cases.js";
import { defineOperation } from "./operation.js";

const OverviewInput = z.strictObject({
  /** Only this project; filled by the host. Absent: every project. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const OverviewOutput = z.strictObject({
  /** In `casefile.yaml` order. */
  projects: z.array(
    z.strictObject({
      name: z.string(),
      path: z.string(),
      cases: z.number().int(),
      /** Case files that do not resolve; they are not in `cases` below. */
      unresolved: z.number().int(),
    }),
  ),
  /** Resolved cases in project and path order, one flat row each. */
  cases: z.array(
    z.strictObject({
      ref: z.string(),
      project: z.string(),
      /** The case's `feature`: its directory under `context/tests/`. */
      feature: z.string(),
      title: z.string(),
      state: z.string(),
      priority: z.string(),
      automation: z.string(),
      /** The case's `automation.ref`, `null` when no test is linked. */
      automation_ref: z.string().nullable(),
      /** The resolved `automation.eligible`: `false` when nobody can automate it. */
      eligible: z.boolean(),
      /** Status of the case's latest run event, `null` without one. */
      last_run: z.string().nullable(),
      last_run_at: z.string().nullable(),
    }),
  ),
});

/**
 * `casefile overview`: every project with its resolved cases, their feature and
 * their latest run, as the local UI lists them (ADR local-ui-stack). Read-only.
 */
export const overviewOperation = defineOperation({
  name: "overview",
  input: OverviewInput,
  output: OverviewOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/overview.md",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const scope = selectProject(workspace, input.project);
    if (!scope.ok) return scope;
    const projects = workspace.projects.filter((p) => scope.value === null || p === scope.value);

    const rows = projects.flatMap((project) => {
      const latest = latestRuns(project);
      return resolved.cases
        .filter((c) => c.project === project.name)
        .map((c) => {
          const run = latest.get(c.id) ?? null;
          return {
            ref: caseRef(c),
            project: c.project,
            feature: c.feature,
            title: c.title,
            state: c.state,
            priority: c.priority,
            automation: c.automation.status,
            automation_ref: c.automation.ref ?? null,
            eligible: c.automation.eligible,
            last_run: run?.status ?? null,
            last_run_at: run?.at ?? null,
          };
        });
    });
    return ok({
      projects: projects.map((p) => {
        const cases = rows.filter((row) => row.project === p.name).length;
        return { name: p.name, path: p.path, cases, unresolved: p.cases.length - cases };
      }),
      cases: rows,
    });
  },
});

/** Each case id's latest run event by `at`; on a tie, the later line wins. */
function latestRuns(project: LoadedProject): Map<string, RunEvent> {
  const latest = new Map<string, RunEvent>();
  for (const { event } of project.runs) {
    const current = latest.get(event.case_id);
    if (current === undefined || Date.parse(event.at) >= Date.parse(current.at)) {
      latest.set(event.case_id, event);
    }
  }
  return latest;
}
