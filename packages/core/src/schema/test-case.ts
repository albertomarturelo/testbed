import { z } from "zod";
import {
  CaseId,
  ChangeId,
  Data,
  Email,
  FeatureSlug,
  Labels,
  Layer,
  Priority,
  Surface,
  Timestamp,
  WorkItem,
} from "./primitives.js";

export const CaseState = z.enum(["draft", "in_review", "active", "retired"]);
export const CaseOrigin = z.enum(["human", "agent", "import"]);

/**
 * Automation status as stored in a case file. `automated` and `flaky` are not
 * listed: they are derived from run events (ADR write-ownership).
 */
export const StoredAutomationStatus = z.enum(["manual", "candidate", "in_progress", "retired"]);

export const Step = z.strictObject({
  do: z.string().min(1),
  expect: z.string().min(1),
  evidence: z.string().min(1).optional(),
});

export const HistoryEventKind = z.enum([
  "created",
  "updated",
  "state_changed",
  "review_requested",
  "reviewed",
  "imported",
  "synced",
  "retired",
]);

/** One append-only history entry. `commit` is derived from `change`, never stored. */
export const HistoryEntry = z.strictObject({
  at: Timestamp,
  by: Email,
  via: z.string().min(1),
  change: ChangeId,
  inbox: z.string().min(1).optional(),
  event: HistoryEventKind,
  note: z.string().optional(),
});

export const Mirror = z.strictObject({
  zephyr: z.string().min(1).optional(),
  xray: z.string().min(1).optional(),
  testrail: z.string().min(1).optional(),
  synced_at: Timestamp.optional(),
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

/**
 * Frontmatter of `context/tests/<feature>/TC-NNNN.md`. Fields that commons can
 * supply are optional here; the resolver requires them on the resolved case.
 */
export const TestCaseFile = z.strictObject({
  id: CaseId,
  feature: FeatureSlug,
  title: z.string().min(1),
  state: CaseState,
  origin: CaseOrigin,
  acceptance_ref: z.array(z.string().min(1)).optional(),
  surfaces: z.array(Surface).min(1).optional(),
  layer: Layer.optional(),
  automation: z
    .strictObject({
      eligible: z.boolean().optional(),
      status: StoredAutomationStatus.optional(),
      ref: z.string().min(1).optional(),
    })
    .optional(),
  priority: Priority.optional(),
  labels: Labels.optional(),
  preconditions: z.array(z.string().min(1)).optional(),
  data: Data.optional(),
  steps: z.array(Step).min(1),
  work_items: z.array(WorkItem).optional(),
  duplicates_checked_against: z.array(CaseId).optional(),
  mirror: Mirror.optional(),
  history: z.array(HistoryEntry).min(1),
});

export type TestCaseFile = z.infer<typeof TestCaseFile>;
export type HistoryEntry = z.infer<typeof HistoryEntry>;
export type Step = z.infer<typeof Step>;
