import { z } from "zod";
import { Data, Email, Labels, Layer, Priority, Surface } from "./primitives.js";

export const ReviewMode = z.enum(["required", "post_hoc", "auto"]);

/** `_common.yaml`: inheritable defaults for a subtree plus review policy. */
export const CommonFile = z.strictObject({
  surfaces: z.array(Surface).min(1).optional(),
  layer: Layer.optional(),
  priority: Priority.optional(),
  automation: z.strictObject({ eligible: z.boolean().optional() }).optional(),
  labels: Labels.optional(),
  preconditions: z.array(z.string().min(1)).optional(),
  data: Data.optional(),
  review: z
    .strictObject({
      mode: ReviewMode,
      reviewers: z.array(Email).optional(),
      max_batch: z.number().int().min(1).optional(),
    })
    .optional(),
  /** CFD docs the agent must read before proposing cases in this subtree. */
  context_refs: z.array(z.string().min(1)).optional(),
});

export type CommonFile = z.infer<typeof CommonFile>;
