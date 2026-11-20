import { fail, ok, type Result } from "../errors.js";
import { evaluateGates, type GateResult, latestBuild, latestResults } from "../gates/evaluate.js";
import type { LoadedRun } from "../load/parse.js";
import { queryCases } from "../query/evaluate.js";
import type { ResolvedCase } from "../resolve/resolve.js";
import { eventMilestone, type Milestone, type ReleasePolicy } from "../schema/index.js";

// Pure (CONVENTIONS #3, #4): a milestone's evidence from its project's cases and
// run files (ADR milestones-group-executions §4). `close` freezes the Markdown;
// `milestone report` prints it.

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
  /** Executions of the case in the milestone; `null` in evidence frozen before #208. */
  attempts: Attempts | null;
};

/** One `milestone edit` (#210) as the evidence lists it (#213): when, who, which fields. */
export type EvidenceEdit = { at: string; by: string; fields: string[] };

/** How often a case was executed in the milestone (passed, failed, blocked) and how many failed. */
export type Attempts = { total: number; failed: number };

/** What a requirement's cases say together (ADR milestones-group-executions §4, #208). */
export type RequirementVerdict = "passed" | "failed" | "blocked" | "not run";

/** One `acceptance_ref` named by in-scope cases, with those cases and their verdict. */
export type RequirementRow = { ref: string; cases: string[]; verdict: RequirementVerdict };

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
  /** Each `milestone edit`, oldest first; empty when it was never edited. */
  edited: EvidenceEdit[];
  closed: { at: string; by: string } | null;
  /** The latest build among the milestone's events (`milestone.build`). */
  build: string | null;
  totals: EvidenceTotals;
  /** One verdict per policy gate; `null` when the project has no policy. */
  gates: GateResult[] | null;
  /** One row per in-scope case, in case order. */
  cases: EvidenceRow[];
  /** One row per `acceptance_ref` of the in-scope cases, by ref. */
  requirements: RequirementRow[];
  /** In-scope cases that name no `acceptance_ref`. */
  unlinked: string[];
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
  const attempts = new Map<string, Attempts>();
  for (const { event } of runs) {
    if (event.status !== "passed" && event.status !== "failed" && event.status !== "blocked") {
      continue;
    }
    const seen = attempts.get(event.case_id) ?? { total: 0, failed: 0 };
    seen.total += 1;
    if (event.status === "failed") seen.failed += 1;
    attempts.set(event.case_id, seen);
  }
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
      attempts: attempts.get(c.id) ?? { total: 0, failed: 0 },
    };
  });
  const { requirements, unlinked } = traceRequirements(scoped.value, cases);
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
    edited: (milestone.edited ?? []).map((edit) => ({
      at: edit.at,
      by: edit.by,
      fields: [...edit.fields],
    })),
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
    requirements,
    unlinked,
    note: input.note ?? null,
  });
}

/**
 * Requirements as the in-scope cases name them (`acceptance_ref`), in ref order,
 * each with its cases in case order and one verdict: failed if any case failed,
 * else blocked, else not run, else passed.
 */
function traceRequirements(
  scoped: readonly ResolvedCase[],
  rows: readonly EvidenceRow[],
): { requirements: RequirementRow[]; unlinked: string[] } {
  const result = new Map(rows.map((row) => [row.id, row.result]));
  const byRef = new Map<string, string[]>();
  const unlinked: string[] = [];
  for (const c of scoped) {
    const refs = [...new Set(c.acceptance_ref ?? [])];
    if (refs.length === 0) unlinked.push(c.id);
    for (const ref of refs) byRef.set(ref, [...(byRef.get(ref) ?? []), c.id]);
  }
  const requirements = [...byRef]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([ref, ids]): RequirementRow => {
      const results = ids.map((id) => result.get(id) ?? null);
      const verdict: RequirementVerdict = results.includes("failed")
        ? "failed"
        : results.includes("blocked")
          ? "blocked"
          : results.includes(null)
            ? "not run"
            : "passed";
      return { ref, cases: ids, verdict };
    });
  return { requirements, unlinked };
}

/** Gates whose verdict is red; empty without a policy. */
export function redGates(evidence: MilestoneEvidence): string[] {
  return (evidence.gates ?? []).filter((g) => g.verdict === "red").map((g) => g.name);
}

/**
 * The evidence as its document reads: every value on one line as a row shows
 * it, gate reasons joined. What the viewer shows and prints, the same shape for
 * an open milestone (generated now) and a closed one (parsed from its frozen
 * file, so the page is the file).
 */
export type EvidenceDocument = {
  project: string;
  slug: string;
  title: string;
  release: string | null;
  due: string | null;
  scope: string;
  build: string | null;
  opened: { at: string; by: string } | null;
  /** Each edit after the open (#213); empty when never edited, and in evidence frozen before #213. */
  edited: EvidenceEdit[];
  closed: { at: string; by: string } | null;
  totals: EvidenceTotals;
  /** `null` when the project has no release policy. */
  gates: { name: string; verdict: string; cases: number; reasons: string | null }[] | null;
  cases: EvidenceRow[];
  /** `null` in evidence frozen before #208, which has no `Requirements` section. */
  requirements: RequirementRow[] | null;
  unlinked: string[] | null;
  note: string | null;
};

/** The document `renderEvidence` writes for this evidence. */
export function evidenceDocument(evidence: MilestoneEvidence): EvidenceDocument {
  const e = evidence;
  const line = (value: string | null) => (value === null ? null : oneLine(value) || null);
  const stamp = (s: { at: string; by: string } | null) =>
    s === null ? null : { at: oneLine(s.at), by: oneLine(s.by) };
  return {
    project: oneLine(e.project),
    slug: oneLine(e.slug),
    title: oneLine(e.title),
    release: line(e.release),
    due: line(e.due),
    scope: oneLine(e.scope),
    build: line(e.build),
    opened: stamp(e.opened),
    edited: e.edited.map((edit) => ({
      at: oneLine(edit.at),
      by: oneLine(edit.by),
      fields: edit.fields.map(oneLine),
    })),
    closed: stamp(e.closed),
    totals: { ...e.totals },
    gates:
      e.gates === null
        ? null
        : e.gates.map((gate) => ({
            name: oneLine(gate.name),
            verdict: gate.verdict,
            cases: gate.cases.length,
            reasons: line(
              gate.reasons
                .map(
                  (r) =>
                    `${r.requirement}: ${r.message}${r.cases.length > 0 ? ` (${r.cases.join(", ")})` : ""}`,
                )
                .join("; "),
            ),
          })),
    cases: e.cases.map((c) => ({
      id: c.id,
      title: oneLine(c.title),
      priority: c.priority,
      result: c.result,
      executor: line(c.executor),
      at: line(c.at),
      build: line(c.build),
      note: line(c.note),
      evidence: c.evidence.map(oneLine),
      attempts: c.attempts === null ? null : { ...c.attempts },
    })),
    requirements: e.requirements.map((r) => ({ ...r, ref: oneLine(r.ref) })),
    unlinked: [...e.unlinked],
    note: e.note === null ? null : e.note.trim() || null,
  };
}

/** The evidence as Markdown, as `close` writes `context/milestones/<slug>/evidence.md`. */
export function renderEvidence(evidence: MilestoneEvidence): string {
  const e = evidenceDocument(evidence);
  const { totals } = e;
  const lines = [
    `# ${TITLE_PREFIX}${e.title}`,
    "",
    "| | |",
    "|---|---|",
    `| Milestone | ${cell(e.slug)} (project ${cell(e.project)}) |`,
    `| Release | ${cell(e.release)} |`,
    `| Due | ${cell(e.due)} |`,
    `| Scope | ${cell(e.scope)} |`,
    `| Build | ${cell(e.build)} |`,
    `| Opened | ${e.opened === null ? EMPTY : `${cell(e.opened.at)} by ${cell(e.opened.by)}`} |`,
    // None for a milestone never edited, so its evidence reads as before #213.
    ...e.edited.map(
      (edit) =>
        `| ${EDITED} | ${cell(edit.at)} by ${cell(edit.by)}: ${cell(edit.fields.join(LIST_SEPARATOR))} |`,
    ),
    `| Closed | ${e.closed === null ? NOT_CLOSED : `${cell(e.closed.at)} by ${cell(e.closed.by)}`} |`,
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
    if (e.gates.length === 0) lines.push(NO_GATES, "");
    else {
      lines.push("| Gate | Verdict | Cases | Reasons |", "|---|---|---:|---|");
      for (const gate of e.gates) {
        lines.push(
          `| ${cell(gate.name)} | ${gate.verdict} | ${gate.cases} | ${cell(gate.reasons)} |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("## Cases", "");
  if (e.cases.length === 0) lines.push(NO_CASES, "");
  else {
    lines.push(
      "| Case | Title | Priority | Result | Attempts | Executor | Date | Build | Note | Evidence |",
      "|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const c of e.cases) {
      lines.push(
        `| ${[
          c.id,
          c.title,
          c.priority,
          c.result ?? NOT_RUN,
          attemptsCell(c.attempts),
          c.executor,
          c.at,
          c.build,
          c.note,
          c.evidence.join(EVIDENCE_SEPARATOR) || null,
        ]
          .map(cell)
          .join(" | ")} |`,
      );
    }
    lines.push("");
  }
  if (e.requirements !== null) {
    lines.push(`## ${REQUIREMENTS}`, "");
    if (e.requirements.length === 0) lines.push(NO_REQUIREMENTS, "");
    else {
      lines.push("| Requirement | Cases | Verdict |", "|---|---|---|");
      for (const r of e.requirements) {
        lines.push(`| ${cell(r.ref)} | ${cell(r.cases.join(LIST_SEPARATOR))} | ${r.verdict} |`);
      }
      lines.push("");
    }
    const unlinked = e.unlinked ?? [];
    if (unlinked.length > 0) {
      lines.push(
        `${UNLINKED_PREFIX}${unlinked.map((id) => oneLine(id)).join(LIST_SEPARATOR)}.`,
        "",
      );
    } else if (e.requirements.length > 0) lines.push(ALL_LINKED, "");
  }
  const missing = e.cases.filter((c) => c.result === null);
  lines.push("## Not executed", "");
  if (missing.length === 0) lines.push("Every case in scope was executed.", "");
  else lines.push(...missing.map((c) => `- ${c.id} ${c.title}`), "");
  if (e.note !== null) lines.push(`## ${CLOSE_NOTE}`, "", e.note, "");
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Reads back a file `renderEvidence` wrote: the frozen evidence of a closed
 * milestone, as a document the viewer can show and print. `null` when the text
 * does not have that shape (edited by hand, or written by another version):
 * the caller shows the text as it is.
 */
export function parseEvidence(markdown: string): EvidenceDocument | null {
  const text = markdown.replace(/\r\n/g, "\n");
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith(`# ${TITLE_PREFIX}`)) return null;
  const title = firstLine.slice(TITLE_PREFIX.length + 2).trim();
  const sections = new Map<string, string[]>();
  let current: string[] = [];
  sections.set("", current);
  for (const line of text.split("\n").slice(1)) {
    if (line.startsWith("## ")) {
      current = [];
      sections.set(line.slice(3).trim(), current);
    } else current.push(line);
  }

  const headRows = tableRows(sections.get("") ?? []);
  const head = new Map(
    headRows.flatMap((row) =>
      row.length === 2 && row[0] !== null ? [[row[0], row[1] ?? null] as const] : [],
    ),
  );
  const edited: EvidenceEdit[] = [];
  for (const [label, value] of headRows) {
    if (label !== EDITED) continue;
    const edit = editOf(value ?? null);
    if (edit === null) return null;
    edited.push(edit);
  }
  const named = head.get("Milestone")?.match(/^(.*) \(project (.*)\)$/);
  const scope = head.get("Scope");
  if (named === null || named === undefined || scope === undefined || scope === null) return null;
  const [, slug = "", project = ""] = named;

  const totalsRow = tableRows(sections.get("Totals") ?? [])[0]?.map(Number);
  if (totalsRow === undefined || totalsRow.length !== 6 || totalsRow.some(Number.isNaN)) {
    return null;
  }
  const [in_scope = 0, executed = 0, passed = 0, failed = 0, blocked = 0, not_run = 0] = totalsRow;

  const gateLines = sections.get("Gates");
  const gates =
    gateLines === undefined
      ? null
      : tableRows(gateLines).map(([name, verdict, cases, reasons]) => ({
          name: name ?? "",
          verdict: verdict ?? "",
          cases: Number(cases ?? 0),
          reasons: reasons ?? null,
        }));

  const caseRows = tableRows(sections.get("Cases") ?? []);
  // 9 columns before #208, 10 with `Attempts` after `Result`.
  const width = caseRows[0]?.length ?? 10;
  if ((width !== 9 && width !== 10) || caseRows.some((row) => row.length !== width)) return null;
  const cases: EvidenceRow[] = [];
  for (const row of caseRows) {
    const [id, caseTitle, priority, result] = row;
    const [executor, at, build, note, evidence] = row.slice(width - 5);
    const attempts = width === 10 ? parseAttempts(row[4] ?? null) : null;
    if (attempts === undefined) return null;
    cases.push({
      id: id ?? "",
      title: caseTitle ?? "",
      priority: priority ?? "",
      result: result === "passed" || result === "failed" || result === "blocked" ? result : null,
      executor: executor ?? null,
      at: at ?? null,
      build: build ?? null,
      note: note ?? null,
      evidence: evidence == null ? [] : evidence.split(EVIDENCE_SEPARATOR),
      attempts,
    });
  }

  const requirementLines = sections.get(REQUIREMENTS);
  let requirements: RequirementRow[] | null = null;
  let unlinked: string[] | null = null;
  if (requirementLines !== undefined) {
    requirements = [];
    for (const [ref, ids, verdict] of tableRows(requirementLines)) {
      if (ref == null || !isRequirementVerdict(verdict)) return null;
      requirements.push({ ref, cases: ids == null ? [] : ids.split(LIST_SEPARATOR), verdict });
    }
    const listed = requirementLines.find((line) => line.startsWith(UNLINKED_PREFIX));
    unlinked =
      listed === undefined
        ? []
        : listed.slice(UNLINKED_PREFIX.length).replace(/\.$/, "").split(LIST_SEPARATOR);
  }
  const noteLines = sections.get(CLOSE_NOTE);

  return {
    project,
    slug,
    title,
    release: head.get("Release") ?? null,
    due: head.get("Due") ?? null,
    scope,
    build: head.get("Build") ?? null,
    opened: stampOf(head.get("Opened")),
    edited,
    closed: stampOf(head.get("Closed")),
    totals: { in_scope, executed, passed, failed, blocked, not_run },
    gates,
    cases,
    requirements,
    unlinked,
    note: noteLines === undefined ? null : noteLines.join("\n").trim() || null,
  };
}

const TITLE_PREFIX = "Milestone evidence: ";
const EDITED = "Edited";
const EMPTY = "—";
const NOT_CLOSED = "not closed: a report, not frozen evidence";
const NOT_RUN = "not run";
const NO_GATES = "The release policy declares no gates.";
const NO_CASES = "The scope selects no cases.";
const CLOSE_NOTE = "Close note";
const EVIDENCE_SEPARATOR = ", ";
const LIST_SEPARATOR = ", ";
const REQUIREMENTS = "Requirements";
const NO_REQUIREMENTS = "No case in scope names a requirement (`acceptance_ref`).";
const ALL_LINKED = "Every case in scope names a requirement.";
const UNLINKED_PREFIX = "Cases that name no requirement: ";
const VERDICTS: readonly RequirementVerdict[] = ["passed", "failed", "blocked", "not run"];

function isRequirementVerdict(value: string | null | undefined): value is RequirementVerdict {
  return VERDICTS.includes(value as RequirementVerdict);
}

/** `3 (1 failed)`, `1`, `0`. */
function attemptsCell(attempts: Attempts | null): string | null {
  if (attempts === null) return null;
  return attempts.failed === 0
    ? String(attempts.total)
    : `${attempts.total} (${attempts.failed} failed)`;
}

/** The inverse of `attemptsCell`; `undefined` when the cell is not one it writes. */
function parseAttempts(value: string | null): Attempts | null | undefined {
  if (value === null) return null;
  const match = value.match(/^(\d+)(?: \((\d+) failed\))?$/);
  if (match === null) return undefined;
  return { total: Number(match[1]), failed: Number(match[2] ?? 0) };
}

/** `<at> by <who>`; `null` for `—` and for a report's "not closed". */
function stampOf(value: string | null | undefined): { at: string; by: string } | null {
  const match = value?.match(/^(\S+) by (.+)$/);
  return match?.[1] === undefined || match[2] === undefined ? null : { at: match[1], by: match[2] };
}

/** `<at> by <who>: <field>, <field>`, the inverse of an `Edited` row; `null` when not one. */
function editOf(value: string | null): EvidenceEdit | null {
  const match = value?.match(/^(\S+) by (.+): ([^:]+)$/);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return { at: match[1], by: match[2], fields: match[3].split(LIST_SEPARATOR) };
}

/** The body rows of the first Markdown table in `lines`, cells unescaped, `—` as `null`. */
function tableRows(lines: readonly string[]): (string | null)[][] {
  const table = lines.filter((line) => line.startsWith("|"));
  // The header row, then the `|---|` separator: the rest is the body.
  return table.slice(2).map(splitRow);
}

/** One table row: split on unescaped `|`, the inverse of `cell`. */
function splitRow(line: string): (string | null)[] {
  const cells: string[] = [];
  let value = "";
  for (let i = 1; i < line.length; i++) {
    const char = line[i];
    if (char === "\\") {
      value += line[i + 1] ?? "";
      i++;
    } else if (char === "|") {
      cells.push(value);
      value = "";
    } else value += char;
  }
  return cells.map((c) => {
    const trimmed = c.trim();
    return trimmed === EMPTY ? null : trimmed;
  });
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
  if (value === null || value === "") return EMPTY;
  return oneLine(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}
