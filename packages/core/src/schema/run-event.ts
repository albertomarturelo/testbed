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

export const Evidence = z.strictObject({
  kind: z.string().min(1),
  ref: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
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
  release: z.string().min(1).optional(),
  duration_ms: z.number().int().min(0).optional(),
  step_results: z.array(StepResult).optional(),
  evidence: z.array(Evidence).optional(),
  automation_ref: z.string().min(1).optional(),
  triage: Triage.optional(),
});

export type RunEvent = z.infer<typeof RunEvent>;
