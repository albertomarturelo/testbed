import { type CasefileError, fail, ok, type Result } from "../errors.js";
import type { LoadedRun } from "../load/parse.js";
import { queryCases } from "../query/evaluate.js";
import type { ResolvedCase } from "../resolve/resolve.js";
import type { Gate, ReleasePolicy, RunEvent } from "../schema/index.js";

// Pure gate evaluation (CONVENTIONS #3, #4); rules in ADR release-gate-evaluation.

const RELEASE_PREFIX = "release:";
const EXECUTED: ReadonlySet<RunEvent["status"]> = new Set(["passed", "failed", "blocked"]);
const FAILED: ReadonlySet<RunEvent["status"]> = new Set(["failed", "blocked"]);

export type GateInput = {
  /** One project's release policy and where it is stored (for error locations). */
  policy: ReleasePolicy;
  policyPath: string;
  /** The project's resolved cases and run events, in load order. */
  cases: readonly ResolvedCase[];
  runs: readonly LoadedRun[];
  /** `release:<name>` or `<name>`. */
  release: string;
  /** Overrides the build taken from the release's run events. */
  build?: string;
  /** Evaluation date, `YYYY-MM-DD`: a triage expiring before it no longer counts. */
  today: string;
};

/** A requirement of `require`, or `scope` when the scope selects no case. */
export type GateReason = {
  requirement: keyof Gate["require"] | "scope";
  message: string;
  /** Offending case ids; empty when the reason is about the gate as a whole. */
  cases: string[];
};

export type GateResult = {
  name: string;
  verdict: "green" | "red";
  /** Ids of the cases the scope selects, in case order. */
  cases: string[];
  reasons: GateReason[];
};

export type GateReport = {
  /** The release name, without `release:`. */
  release: string;
  /** `release.build`: the caller's, or the latest build among the release's runs. */
  build: string | null;
  gates: GateResult[];
};

/**
 * Evaluates every gate of a policy for one release. A scope that does not parse
 * or uses an unknown variable fails the whole evaluation; every bad scope is
 * reported, located at its gate.
 */
export function evaluateGates(input: GateInput): Result<GateReport> {
  const release = releaseName(input.release);
  const runs = input.runs.filter((r) => r.event.release === release);
  const build = input.build ?? latestBuild(runs);
  const context = { release: build === null ? { name: release } : { name: release, build } };
  const latest = latestResults(runs);

  const gates: GateResult[] = [];
  const errors: CasefileError[] = [];
  for (const [index, gate] of input.policy.gates.entries()) {
    const scoped = queryCases(gate.scope, input.cases, context);
    if (!scoped.ok) {
      const field = `gates.${index}.scope`;
      errors.push(...scoped.errors.map((error) => ({ ...error, path: input.policyPath, field })));
      continue;
    }
    const ids = scoped.value.map((c) => c.id);
    const reasons = checkGate(gate, ids, latest, build, input.today);
    gates.push({
      name: gate.name,
      verdict: reasons.length === 0 ? "green" : "red",
      cases: ids,
      reasons,
    });
  }
  return errors.length > 0 ? fail(...errors) : ok({ release, build, gates });
}

/** `release:web-1.2.0` and `web-1.2.0` both name `web-1.2.0`. */
export function releaseName(ref: string): string {
  return ref.startsWith(RELEASE_PREFIX) ? ref.slice(RELEASE_PREFIX.length) : ref;
}

/** Later by `at`, then by load order: runs are already in load order. */
function latestBuild(runs: readonly LoadedRun[]): string | null {
  let found: RunEvent | null = null;
  for (const { event } of runs) {
    if (event.build !== undefined && (found === null || notBefore(event, found))) found = event;
  }
  return found?.build ?? null;
}

/** Per case, its latest execution: a later `skipped`/`not_run` never hides one. */
function latestResults(runs: readonly LoadedRun[]): Map<string, RunEvent> {
  const latest = new Map<string, RunEvent>();
  for (const { event } of runs) {
    if (!EXECUTED.has(event.status)) continue;
    const current = latest.get(event.case_id);
    if (current === undefined || notBefore(event, current)) latest.set(event.case_id, event);
  }
  return latest;
}

function checkGate(
  gate: Gate,
  ids: readonly string[],
  latest: ReadonlyMap<string, RunEvent>,
  build: string | null,
  today: string,
): GateReason[] {
  if (ids.length === 0) {
    return [{ requirement: "scope", message: `scope selects no cases: ${gate.scope}`, cases: [] }];
  }
  const { require } = gate;
  const results = ids.flatMap((id) => {
    const event = latest.get(id);
    return event === undefined ? [] : [{ id, event }];
  });
  const where = (test: (event: RunEvent) => boolean) =>
    results.filter((r) => test(r.event)).map((r) => r.id);
  const reasons: GateReason[] = [];

  if (require.executed !== undefined) {
    const executed = new Set(results.map((r) => r.id));
    const missing = ids.filter((id) => !executed.has(id));
    if (!meets(executed.size, ids.length, require.executed)) {
      reasons.push({
        requirement: "executed",
        message: `${percent(executed.size, ids.length)} of ${ids.length} cases executed, ${require.executed} % required`,
        cases: missing,
      });
    }
  }
  if (require.passed !== undefined) {
    const passed = new Set(where((e) => e.status === "passed"));
    if (!meets(passed.size, ids.length, require.passed)) {
      reasons.push({
        requirement: "passed",
        message: `${percent(passed.size, ids.length)} of ${ids.length} cases passed, ${require.passed} % required`,
        cases: ids.filter((id) => !passed.has(id)),
      });
    }
  }
  if (require.failures === "none") {
    const failed = where((e) => FAILED.has(e.status));
    if (failed.length > 0) {
      reasons.push({ requirement: "failures", message: "failures are not allowed", cases: failed });
    }
  } else if (require.failures === "triaged") {
    const untriaged = where((e) => FAILED.has(e.status) && !triaged(e, today));
    if (untriaged.length > 0) {
      reasons.push({
        requirement: "failures",
        message: "failures without a current triage",
        cases: untriaged,
      });
    }
  }
  if (require.executor !== undefined) {
    const accepted: readonly string[] = require.executor;
    const other = where((e) => !accepted.includes(executorKind(e)));
    if (other.length > 0) {
      reasons.push({
        requirement: "executor",
        message: `results not from an accepted executor (${accepted.join(", ")})`,
        cases: other,
      });
    }
  }
  if (require.build === "current") {
    if (build === null) {
      reasons.push({ requirement: "build", message: "no build known for the release", cases: [] });
    } else {
      const other = where((e) => e.build !== build);
      if (other.length > 0) {
        reasons.push({
          requirement: "build",
          message: `results not on build ${build}`,
          cases: other,
        });
      }
    }
  }
  if (require.source === "automated" || require.source === "manual") {
    const automated = require.source === "automated";
    const other = where((e) => (e.automation_ref !== undefined) !== automated);
    if (other.length > 0) {
      reasons.push({
        requirement: "source",
        message: `results not ${require.source}`,
        cases: other,
      });
    }
  }
  return reasons;
}

/** Timestamps carry offsets, so compare instants; on a tie the later-loaded event wins. */
function notBefore(event: RunEvent, other: RunEvent): boolean {
  return Date.parse(event.at) >= Date.parse(other.at);
}

/** `count / total ≥ required %`, cross-multiplied so no division rounds the share. */
function meets(count: number, total: number, required: number): boolean {
  return count * 100 >= required * total;
}

function percent(count: number, total: number): string {
  return `${Math.floor((count * 100) / total)} %`;
}

function triaged(event: RunEvent, today: string): boolean {
  const { triage } = event;
  return triage !== undefined && (triage.expires === undefined || triage.expires >= today);
}

/** `ci:github-actions` → `ci`. */
function executorKind(event: RunEvent): string {
  return event.executor.slice(0, event.executor.indexOf(":"));
}
