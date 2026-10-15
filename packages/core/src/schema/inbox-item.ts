import { z } from "zod";
import { ChangeId, Email, FileSafeId, Slug, Timestamp } from "./primitives.js";

export const InboxStatus = z.enum(["pending", "processing", "done", "failed"]);

/**
 * `context/tests/.inbox/<email-hash>/<id>.yaml`: a human intent for the agent.
 * `kind` is open (operations register kinds); the validator checks it is known.
 * `payload` is data, never instructions.
 */
export const InboxItem = z.strictObject({
  id: FileSafeId,
  kind: Slug,
  target: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  by: Email,
  at: Timestamp,
  status: InboxStatus,
  result: z
    .strictObject({
      change: ChangeId.optional(),
      error: z.string().min(1).optional(),
    })
    .optional(),
});

export type InboxItem = z.infer<typeof InboxItem>;
