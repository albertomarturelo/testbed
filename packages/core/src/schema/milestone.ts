import { z } from "zod";
import { CalendarDate, ChangeId, Email, Timestamp } from "./primitives.js";

/** Who opened or closed a milestone, when, and the change id of that commit. */
export const MilestoneStamp = z.strictObject({
  at: Timestamp,
  by: Email,
  change: ChangeId,
});

/**
 * `context/milestones/<slug>.yaml` (ADR milestones-group-executions §1): a group
 * of executions, like a GitHub milestone. The slug is the file name; run events
 * name it in `milestone`. Closing it (#165) adds `closed` and freezes its evidence.
 */
export const Milestone = z.strictObject({
  /** One line: `Web 2.1.0`, `Sprint 23 regression`, `UAT round 1`. */
  title: z
    .string()
    .min(1)
    .regex(/^[^\r\n]*$/, "one line"),
  state: z.enum(["open", "closed"]),
  due: CalendarDate.optional(),
  /** The version or Git tag the milestone certifies, when it is a release. */
  release: z.string().min(1).optional(),
  /** The cases it covers, as a query (ADR single-query-dsl); default `state = active`. */
  scope: z.string().min(1).optional(),
  opened: MilestoneStamp.optional(),
  closed: MilestoneStamp.optional(),
});

export type Milestone = z.infer<typeof Milestone>;
