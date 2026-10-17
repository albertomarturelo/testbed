import { posix } from "node:path";
import { z } from "zod";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import { TESTS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { requireProject } from "../operations/cases.js";
import { defineOperation, type Operation } from "../operations/operation.js";
import { Executor, FileSafeId, RunEvent, RunStatus, Slug } from "../schema/index.js";
import { IngestedResult, type Ingester } from "./ingester.js";

const IngestInput = z.strictObject({
  /** The report file, relative to the workspace root. */
  report: z.string().min(1),
  /** The run id: names `.runs/<run>.jsonl`. */
  run: FileSafeId,
  /** `ci:<name>` or `agent:<name>`, matching the actor. */
  executor: Executor,
  env: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
  release: z.string().min(1).optional(),
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const IngestOutput = z.strictObject({
  project: z.string(),
  run: z.string(),
  /** The run file, workspace-relative. */
  path: z.string(),
  /** Test results in the report. */
  results: z.number().int(),
  /** Run events those results gave (one per matched case). */
  events: z.number().int(),
  /** Events written now; the rest were already in the run file. */
  appended: z.number().int(),
  /** Results whose ref is no case's `automation.ref`: reported, never written. */
  unmatched: z.array(z.strictObject({ ref: z.string(), status: RunStatus })),
  next: z.array(z.string()),
});

/**
 * The operation `ingest-<format>` for an ingester (ADR ingester-contract §2):
 * `casefile ingest <format> <report> --run <id> --executor ci:<name>`. Matches
 * results to the project's cases by `automation.ref` and appends new run events
 * to `<project>/context/tests/.runs/<run>.jsonl`. Makes no commit.
 */
export function ingestOperation(ingester: Ingester): Operation {
  return defineOperation({
    name: `ingest-${ingester.format}`,
    input: IngestInput,
    output: IngestOutput,
    actor: ["ci", "agent"],
    writes: [`**/${TESTS_DIR}/.runs/*.jsonl`],
    spec: ingester.spec,
    subject: "report",
    async run(input, context) {
      const kind = input.executor.slice(0, input.executor.indexOf(":"));
      if (kind !== context.actor) {
        return fail({
          code: "ingest.executor_mismatch",
          field: "executor",
          message: `a ${context.actor} ingests as ${context.actor}:<name>, not ${input.executor} (ADR write-ownership)`,
        });
      }
      const workspace = await loadWorkspace(context.root);
      if (workspace.config === null) return fail(...workspace.errors);
      const selected = requireProject(workspace, input.project);
      if (!selected.ok) return selected;
      const project = selected.value;

      const text = await context.readText(input.report);
      if (text === null) {
        return fail({
          code: "ingest.report_missing",
          field: "report",
          path: input.report,
          message: `${input.report} does not exist (report paths are relative to the workspace root)`,
        });
      }
      const parsed: unknown = await ingester.parse(text, { path: input.report });
      // An extension's ingester is not type-checked: only a well-formed Result passes.
      if (!isResultList(parsed)) {
        return fail({
          code: "ingest.invalid_result",
          path: input.report,
          message: `ingester '${ingester.format}' returned neither { ok: true, value: [...] } nor { ok: false, errors: [...] }`,
        });
      }
      if (!parsed.ok) return parsed;
      const results: IngestedResult[] = [];
      const errors: CasefileError[] = [];
      for (const [index, item] of parsed.value.entries()) {
        const checked = IngestedResult.safeParse(item);
        if (checked.success) results.push(checked.data);
        else {
          errors.push(
            ...checked.error.issues.map((issue) => ({
              code: "ingest.invalid_result",
              path: input.report,
              field: ["results", index, ...issue.path].join("."),
              message: `ingester '${ingester.format}': ${issue.message}`,
            })),
          );
        }
      }
      if (errors.length > 0) return fail(...errors);

      const casesByRef = new Map<string, string[]>();
      for (const { file } of project.cases) {
        const ref = file.automation?.ref;
        if (ref !== undefined) casesByRef.set(ref, [...(casesByRef.get(ref) ?? []), file.id]);
      }
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const events: RunEvent[] = [];
      const unmatched: { ref: string; status: RunEvent["status"] }[] = [];
      for (const result of mergeByRef(results)) {
        const ids = casesByRef.get(result.ref);
        if (ids === undefined) unmatched.push({ ref: result.ref, status: result.status });
        for (const id of ids ?? []) {
          const event = RunEvent.safeParse({
            run_id: input.run,
            case_id: id,
            status: result.status,
            executor: input.executor,
            at: result.at ?? now,
            env: input.env,
            build: input.build,
            release: input.release,
            duration_ms: result.duration_ms,
            evidence: result.evidence,
            automation_ref: result.ref,
          });
          if (event.success) events.push(event.data);
          else {
            errors.push(
              ...event.error.issues.map((issue) => ({
                code: "ingest.invalid_event",
                field: issue.path.join("."),
                message: `the event for ${id} (${result.ref}) is not a valid run event: ${issue.message}`,
              })),
            );
          }
        }
      }
      if (errors.length > 0) return fail(...errors);

      const path = posix.join(project.path, TESTS_DIR, ".runs", `${input.run}.jsonl`);
      const existing = (await context.readText(path)) ?? "";
      const fresh = notYetIn(existing, events);
      if (fresh.length > 0) {
        const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
        const lines = fresh.map((event) => `${JSON.stringify(event)}\n`).join("");
        await context.writeText(path, `${existing}${separator}${lines}`);
      }

      const next: string[] = [];
      if (fresh.length > 0) {
        next.push(
          `Commit ${path}: casefile reads runs from the repository, and ingest commits nothing`,
        );
      } else if (events.length > 0) {
        next.push(`Nothing new: every event is already in ${path}`);
      }
      if (unmatched.length > 0) {
        next.push(
          `${unmatched.length} ${unmatched.length === 1 ? "result matches" : "results match"} no case's automation.ref: set that ref on the case it verifies (\`casefile spec cover\`), or leave it unmatched`,
        );
      }
      return ok({
        project: project.name,
        run: input.run,
        path,
        results: results.length,
        events: events.length,
        appended: fresh.length,
        unmatched,
        next,
      });
    },
  });
}

function isResultList(value: unknown): value is Result<unknown[]> {
  if (value === null || typeof value !== "object") return false;
  const result = value as { ok?: unknown; value?: unknown; errors?: unknown };
  if (result.ok === true) return Array.isArray(result.value);
  return result.ok === false && Array.isArray(result.errors);
}

/** Worst first: a failure is never hidden by a pass, an execution never by a skip. */
const SEVERITY: readonly RunEvent["status"][] = [
  "failed",
  "blocked",
  "passed",
  "not_run",
  "skipped",
];

type Merged = Omit<IngestedResult, "source">;

/**
 * One result per ref (ADR ingester-contract §9). A test run in several
 * Playwright projects reports one result per project, usually with the same
 * `at`; as separate events, a gate's tie-break by file order could let
 * "chromium passed" hide "firefox failed". Merged: the worst status, the
 * latest `at`, the longest duration, and one `result:<status>` evidence entry
 * per source, in report order. Refs come in order of first appearance.
 */
function mergeByRef(results: readonly IngestedResult[]): Merged[] {
  const groups = new Map<string, IngestedResult[]>();
  for (const result of results) groups.set(result.ref, [...(groups.get(result.ref) ?? []), result]);
  return [...groups.values()].map((group) => {
    const [first, ...rest] = group as [IngestedResult, ...IngestedResult[]];
    const { source: _, ...single } = first;
    if (rest.length === 0) return single;
    const status = SEVERITY.find((s) => group.some((r) => r.status === s)) ?? first.status;
    const times = group.flatMap((r) => (r.at === undefined ? [] : [r.at]));
    const at = times.reduce<string | undefined>(
      (latest, time) =>
        latest === undefined || Date.parse(time) > Date.parse(latest) ? time : latest,
      undefined,
    );
    const durations = group.flatMap((r) => (r.duration_ms === undefined ? [] : [r.duration_ms]));
    const evidence = group.flatMap((r, i) => [
      ...(r.evidence ?? []),
      { kind: `result:${r.status}`, ref: r.source ?? `#${i + 1}` },
    ]);
    return {
      ref: first.ref,
      status,
      ...(at === undefined ? {} : { at }),
      ...(durations.length === 0 ? {} : { duration_ms: Math.max(...durations) }),
      evidence,
    };
  });
}

/**
 * The events the run file does not hold yet (ADR ingester-contract §6): equal
 * apart from `at`, counted as a multiset, so a report ingested twice adds
 * nothing and two identical results in one report are both kept.
 */
function notYetIn(existing: string, events: readonly RunEvent[]): RunEvent[] {
  const seen = new Map<string, number>();
  for (const line of existing.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue; // `casefile validate` reports it; it matches nothing.
    }
    const key = identity(value);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return events.filter((event) => {
    const key = identity(event);
    const count = seen.get(key) ?? 0;
    if (count === 0) return true;
    seen.set(key, count - 1);
    return false;
  });
}

/** An event without `at`, keys sorted at every level: equal events, equal strings. */
function identity(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item === null || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, sorted((item as Record<string, unknown>)[key])]),
    );
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const { at: _, ...rest } = value as Record<string, unknown>;
  return JSON.stringify(sorted(rest));
}

/**
 * Why a value from an extension's `manifest.ingesters` cannot become an
 * operation; `[]` when it can. The registry checks the operation itself.
 */
export function ingesterProblems(ingester: unknown): string[] {
  if (ingester === null || typeof ingester !== "object") {
    return [`${JSON.stringify(ingester)} is not an ingester object`];
  }
  const { format, parse } = ingester as Partial<Ingester>;
  if (typeof format !== "string" || !Slug.safeParse(format).success) {
    return [`ingester format '${String(format)}' is not a slug`];
  }
  return typeof parse === "function" ? [] : [`ingester '${format}' has no parse()`];
}
