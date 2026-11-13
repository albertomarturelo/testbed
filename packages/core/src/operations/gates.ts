import { posix } from "node:path";
import { z } from "zod";
import { fail, ok } from "../errors.js";
import { evaluateGates, releaseName } from "../gates/evaluate.js";
import { POLICY_FILE } from "../load/paths.js";
import { CalendarDate, eventMilestone } from "../schema/index.js";
import { loadWorkspaceCases, requireProject } from "./cases.js";
import { evidencePath } from "./milestones.js";
import { defineOperation } from "./operation.js";

const GatesInput = z.strictObject({
  /** The milestone: `web-1.2.0`, or the old ref `release:web-1.2.0`. */
  milestone: z.string().min(1),
  /** Evaluation date, `YYYY-MM-DD`: a triage expiring before it no longer counts. Default: today (UTC). */
  date: CalendarDate.optional(),
  /** `milestone.build`; default: the latest build among the milestone's executions. */
  build: z.string().min(1).optional(),
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const GatesOutput = z.strictObject({
  project: z.string(),
  milestone: z.string(),
  /** `undeclared`: run events name it, no milestone file does (an old free-text release). */
  state: z.enum(["open", "closed", "undeclared"]),
  date: z.string(),
  build: z.string().nullable(),
  /** Every gate is green. */
  green: z.boolean(),
  /** One per gate of `releases/policy.yaml`, in its order. */
  gates: z.array(
    z.strictObject({
      name: z.string(),
      verdict: z.enum(["green", "red"]),
      /** Ids of the cases its scope selects. */
      cases: z.array(z.string()),
      /** Why it is red: one per failed requirement, with the offending cases. */
      reasons: z.array(
        z.strictObject({
          requirement: z.string(),
          message: z.string(),
          cases: z.array(z.string()),
        }),
      ),
    }),
  ),
  next: z.array(z.string()),
});

/**
 * `casefile gates <milestone>` (ADR release-gate-evaluation, ADR
 * milestones-group-executions): each gate of the project's release policy,
 * green or red, for the executions in one milestone. Read-only; red gates are
 * a result, not an error.
 */
export const gatesOperation = defineOperation({
  name: "gates",
  input: GatesInput,
  output: GatesOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/gates.md",
  subject: "milestone",
  async run(input, context) {
    const name = releaseName(input.milestone);
    if (name === "") {
      return fail({
        code: "gates.invalid_milestone",
        field: "milestone",
        message: `'${input.milestone}' names no milestone: give its slug, e.g. web-1.2.0`,
      });
    }
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;

    const policyPath = posix.join(project.path, POLICY_FILE);
    if (project.policy === null) {
      const invalid = workspace.errors.filter((e) => e.path === policyPath);
      if (invalid.length > 0) return fail(...invalid);
      return fail({
        code: "gates.no_policy",
        path: policyPath,
        message: `project '${project.name}' has no ${policyPath}: it declares no gates`,
      });
    }

    const date = input.date ?? new Date().toISOString().slice(0, 10);
    const report = evaluateGates({
      policy: project.policy,
      policyPath,
      cases: resolved.cases.filter((c) => c.project === project.name),
      runs: project.runs,
      release: name,
      ...(input.build === undefined ? {} : { build: input.build }),
      today: date,
    });
    if (!report.ok) return report;

    const declared = project.milestones.get(name);
    const state = declared?.file.state ?? "undeclared";
    const executed = project.runs.some((r) => eventMilestone(r.event) === name);
    const next: string[] = [];
    if (!executed) {
      next.push(
        `No execution names '${name}' yet: record results with --milestone ${name} (casefile run, casefile ingest)`,
      );
    }
    if (declared === undefined) {
      next.push(
        `'${name}' is not a declared milestone${executed ? " (an old free-text release)" : ""}: open it to group its executions: casefile milestone open ${name} --title <title>`,
      );
    } else if (state === "closed") {
      next.push(
        `'${name}' is closed: these verdicts are evaluated now; the record is its frozen evidence, ${evidencePath(project, name)} (casefile milestone report ${name})`,
      );
    }
    const gates = report.value.gates.map((gate) => ({
      name: gate.name,
      verdict: gate.verdict,
      cases: gate.cases,
      reasons: gate.reasons.map((r) => ({
        requirement: r.requirement,
        message: r.message,
        cases: r.cases,
      })),
    }));
    return ok({
      project: project.name,
      milestone: name,
      state,
      date,
      build: report.value.build,
      green: gates.every((g) => g.verdict === "green"),
      gates,
      next,
    });
  },
});
