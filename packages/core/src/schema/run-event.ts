import { z } from "zod";
import {
  CalendarDate,
  CaseId,
  Email,
  Executor,
  FileSafeId,
  Surface,
  Timestamp,
} from "./primitives.js";

export const RunStatus = z.enum(["passed", "failed", "blocked", "skipped", "not_run"]);
export const TriageKind = z.enum(["defect", "test_bug", "known_issue", "flaky", "environment"]);

/** What a person reads for one piece of evidence (ADR run-evidence-files §3). */
export const EvidenceLabel = z.string().min(1).max(120);

/**
 * A file or link attached to a result. `run` writes `image`, `video` and `file`
 * entries with `sha256` and `link` entries without; ingest writes references
 * (`attachment`). The schema keeps `sha256` optional: `run` and `validate`
 * apply the per-kind rules (ADR run-evidence-files §3).
 */
export const Evidence = z.strictObject({
  kind: z.string().min(1),
  ref: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  label: EvidenceLabel.optional(),
});

export const StepResult = z.strictObject({
  /** 1-based index into the case's `steps`. */
  step: z.number().int().min(1),
  status: RunStatus,
  note: z.string().optional(),
});

export const Triage = z.strictObject({
  kind: TriageKind,
  by: Email,
  ref: z.string().min(1).optional(),
  expires: CalendarDate.optional(),
  note: z.string().optional(),
});

/** Longest `note` on a run event; ingest cuts longer ones (ADR run-event-note). */
export const NOTE_MAX = 2000;

/** One line of `context/tests/.runs/<run-id>.jsonl`. Append-only; corrections are new events. */
export const RunEvent = z.strictObject({
  run_id: FileSafeId,
  case_id: CaseId,
  status: RunStatus,
  executor: Executor,
  at: Timestamp,
  surface: Surface.optional(),
  env: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
  /** The milestone the execution belongs to (ADR milestones-group-executions). */
  milestone: z.string().min(1).optional(),
  /** What files written before `0.2.0` call the milestone; read as `milestone`, never written. */
  release: z.string().min(1).optional(),
  duration_ms: z.number().int().min(0).optional(),
  step_results: z.array(StepResult).optional(),
  evidence: z.array(Evidence).optional(),
  automation_ref: z.string().min(1).optional(),
  /** What the executor said about the result: a failure message, a tester's remark. */
  note: z.string().min(1).max(NOTE_MAX).optional(),
  triage: Triage.optional(),
});

export type RunEvent = z.infer<typeof RunEvent>;
export type Evidence = z.infer<typeof Evidence>;

/**
 * The milestone an event belongs to: `milestone`, else the `release` that run
 * files from before `0.2.0` wrote (ADR milestones-group-executions §8).
 */
export function eventMilestone(event: {
  milestone?: string;
  release?: string;
}): string | undefined {
  return event.milestone ?? event.release;
}

/**
 * An event as `0.2.0` writes it: an old `release` moved to `milestone`, so an
 * old line and a new one compare equal. For comparing only: run files are
 * append-only and never rewritten.
 */
export function withMilestone<T extends object>(event: T): T {
  const { release, ...rest } = event as T & { release?: unknown; milestone?: unknown };
  if (release === undefined || rest.milestone !== undefined) return event;
  return { ...rest, milestone: release } as T;
}
