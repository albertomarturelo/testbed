import { fail, ok, type Result } from "../errors.js";
import { evaluateGates, type GateResult, latestBuild, latestResults } from "../gates/evaluate.js";
import type { LoadedRun } from "../load/parse.js";
import { queryCases } from "../query/evaluate.js";
import type { ResolvedCase } from "../resolve/resolve.js";
import { eventMilestone, type Milestone, type ReleasePolicy } from "../schema/index.js";

// Pure (CONVENTIONS #3, #4): a milestone's evidence from its project's cases and
// run files (ADR milestones-group-executions §4). `close` freezes the Markdown;
// `report` prints it; #115's report reuses `renderEvidence`.

/** What a milestone covers when its file names no `scope` (ADR milestones-group-executions §1). */
export const DEFAULT_MILESTONE_SCOPE = "state = active";

/** Longest run note a row shows; the run file keeps the whole note. */
export const EVIDENCE_NOTE_MAX = 300;

export type EvidenceInput = {
  project: string;
  slug: string;
  milestone: Milestone;
  /** Where the milestone file is, to locate an error in its `scope`. */
  milestonePath: string;
  /** The project's resolved cases. */
  cases: readonly ResolvedCase[];
  /** The project's run events, in load order; only the milestone's count. */
  runs: readonly LoadedRun[];
  /** `context/releases/policy.yaml` and its path, or `null` when the project has none. */
  policy: { policy: ReleasePolicy; path: string } | null;
  /** Who closes it and when; `null` while it is only reported. */
  closed: { at: string; by: string } | null;
  /** The close note: why red gates were accepted, or anything the closer adds. */
  note?: string;
  /** `YYYY-MM-DD`: a triage that expired before it no longer counts (gates). */
  today: string;
};

export type EvidenceRow = {
  id: string;
  title: string;
  priority: string;
  /** The latest execution in the milestone; `null` when the case was not executed. */
  result: "passed" | "failed" | "blocked" | null;
  executor: string | null;
  at: string | null;
  build: string | null;
  note: string | null;
  evidence: string[];
};

export type EvidenceTotals = {
  in_scope: number;
  executed: number;
  passed: number;
  failed: number;
  blocked: number;
  not_run: number;
};

export type MilestoneEvidence = {
  project: string;
  slug: string;
  title: string;
  release: string | null;
  due: string | null;
  scope: string;
  opened: { at: string; by: string } | null;
  closed: { at: string; by: string } | null;
  /** The latest build among the milestone's events (`milestone.build`). */
  build: string | null;
  totals: EvidenceTotals;
  /** One verdict per policy gate; `null` when the project has no policy. */
  gates: GateResult[] | null;
  /** One row per in-scope case, in case order. */
  cases: EvidenceRow[];
  note: string | null;
};

/**
 * The evidence of one milestone. Deterministic: the same cases, runs, policy,
 * stamp and date give the same value. A scope that does not parse fails, located
 * at the milestone file or the policy gate.
 */
export function milestoneEvidence(input: EvidenceInput): Result<MilestoneEvidence> {
  const { milestone, slug } = input;
  const runs = input.runs.filter((r) => eventMilestone(r.event) === slug);
  const build = latestBuild(runs);
  const values = build === null ? { name: slug } : { name: slug, build };
  const scope = milestone.scope ?? DEFAULT_MILESTONE_SCOPE;
  const scoped = queryCases(scope, input.cases, { milestone: values, release: values });
  if (!scoped.ok) {
    return fail(
      ...scoped.errors.map((error) => ({ ...error, path: input.milestonePath, field: "scope" })),
    );
  }

  let gates: GateResult[] | null = null;
  if (input.policy !== null) {
    const report = evaluateGates({
      policy: input.policy.policy,
      policyPath: input.policy.path,
      cases: input.cases,
      runs: input.runs,
      release: slug,
      today: input.today,
    });
    if (!report.ok) return report;
    gates = report.value.gates;
  }

  const latest = latestResults(runs);
  const cases = scoped.value.map((c): EvidenceRow => {
    const event = latest.get(c.id);
    return {
      id: c.id,
      title: c.title,
      priority: c.priority,
      result: (event?.status as EvidenceRow["result"] | undefined) ?? null,
      executor: event?.executor ?? null,
      at: event?.at ?? null,
      build: event?.build ?? null,
      note: event === undefined ? null : rowNote(event.note, event.triage),
      evidence: event?.evidence?.map((e) => e.ref) ?? [],
    };
  });
  const count = (result: EvidenceRow["result"]) => cases.filter((c) => c.result === result).length;
  const notRun = count(null);

  return ok({
    project: input.project,
    slug,
    title: milestone.title,
    release: milestone.release ?? null,
    due: milestone.due ?? null,
    scope,
    opened:
      milestone.opened === undefined ? null : { at: milestone.opened.at, by: milestone.opened.by },
    closed: input.closed,
    build,
    totals: {
      in_scope: cases.length,
      executed: cases.length - notRun,
      passed: count("passed"),
      failed: count("failed"),
      blocked: count("blocked"),
      not_run: notRun,
    },
    gates,
    cases,
    note: input.note ?? null,
  });
}

/** Gates whose verdict is red; empty without a policy. */
export function redGates(evidence: MilestoneEvidence): string[] {
  return (evidence.gates ?? []).filter((g) => g.verdict === "red").map((g) => g.name);
}

/** The evidence as Markdown, as `close` writes `context/milestones/<slug>/evidence.md`. */
export function renderEvidence(evidence: MilestoneEvidence): string {
  const e = evidence;
  const { totals } = e;
  const lines = [
    `# Milestone evidence: ${oneLine(e.title)}`,
    "",
    "| | |",
    "|---|---|",
    `| Milestone | ${cell(e.slug)} (project ${cell(e.project)}) |`,
    `| Release | ${cell(e.release)} |`,
    `| Due | ${cell(e.due)} |`,
    `| Scope | ${cell(e.scope)} |`,
    `| Build | ${cell(e.build)} |`,
    `| Opened | ${e.opened === null ? "—" : `${cell(e.opened.at)} by ${cell(e.opened.by)}`} |`,
    `| Closed | ${e.closed === null ? "not closed: a report, not frozen evidence" : `${cell(e.closed.at)} by ${cell(e.closed.by)}`} |`,
    "",
    "## Totals",
    "",
    "| In scope | Executed | Passed | Failed | Blocked | Not run |",
    "|---:|---:|---:|---:|---:|---:|",
    `| ${totals.in_scope} | ${totals.executed} | ${totals.passed} | ${totals.failed} | ${totals.blocked} | ${totals.not_run} |`,
    "",
  ];
  if (e.gates !== null) {
    lines.push("## Gates", "");
    if (e.gates.length === 0) lines.push("The release policy declares no gates.", "");
    else {
      lines.push("| Gate | Verdict | Cases | Reasons |", "|---|---|---:|---|");
      for (const gate of e.gates) {
        const reasons = gate.reasons.map(
          (r) =>
            `${r.requirement}: ${r.message}${r.cases.length > 0 ? ` (${r.cases.join(", ")})` : ""}`,
        );
        lines.push(
          `| ${cell(gate.name)} | ${gate.verdict} | ${gate.cases.length} | ${cell(reasons.join("; ") || null)} |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("## Cases", "");
  if (e.cases.length === 0) lines.push("The scope selects no cases.", "");
  else {
    lines.push(
      "| Case | Title | Priority | Result | Executor | Date | Build | Note | Evidence |",
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const c of e.cases) {
      lines.push(
        `| ${[
          c.id,
          c.title,
          c.priority,
          c.result ?? "not run",
          c.executor,
          c.at,
          c.build,
          c.note,
          c.evidence.join(", ") || null,
        ]
          .map(cell)
          .join(" | ")} |`,
      );
    }
    lines.push("");
  }
  const missing = e.cases.filter((c) => c.result === null);
  lines.push("## Not executed", "");
  if (missing.length === 0) lines.push("Every case in scope was executed.", "");
  else lines.push(...missing.map((c) => `- ${c.id} ${oneLine(c.title)}`), "");
  if (e.note !== null) lines.push("## Close note", "", e.note.trim(), "");
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The run's note, then its triage, on one line; long notes are cut (the run file keeps them). */
function rowNote(
  note: string | undefined,
  triage: { kind: string; ref?: string; expires?: string } | undefined,
): string | null {
  const parts = [
    ...(note === undefined ? [] : [cut(oneLine(note))]),
    ...(triage === undefined
      ? []
      : [
          `triage ${triage.kind}${triage.ref === undefined ? "" : ` ${triage.ref}`}${triage.expires === undefined ? "" : ` until ${triage.expires}`}`,
        ]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cut(text: string): string {
  return text.length <= EVIDENCE_NOTE_MAX ? text : `${text.slice(0, EVIDENCE_NOTE_MAX - 1)}…`;
}

/** A table cell: one line, `|` escaped, `—` when empty. */
function cell(value: string | null): string {
  if (value === null || value === "") return "—";
  return oneLine(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}
