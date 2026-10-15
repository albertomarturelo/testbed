import { z } from "zod";
import { Email } from "./primitives.js";

const Percent = z.number().min(0).max(100);

/** What a gate requires of the in-scope cases' latest results. */
export const GateRequirement = z.strictObject({
  /** Minimum % of in-scope cases with at least one result. */
  executed: Percent.optional(),
  /** Minimum % of in-scope cases whose latest result passed. */
  passed: Percent.optional(),
  /** `none`: no failures allowed. `triaged`: every failure carries a triage. */
  failures: z.enum(["none", "triaged"]).optional(),
  /** Accepted executor kinds. */
  executor: z
    .array(z.enum(["human", "agent", "ci"]))
    .min(1)
    .optional(),
  /** `current`: results must be on `release.build`. */
  build: z.enum(["current", "any"]).optional(),
  /** Whether results must come from automation, manual execution, or either. */
  source: z.enum(["automated", "manual", "any"]).optional(),
});

export const Gate = z.strictObject({
  name: z.string().min(1),
  /** Query DSL expression selecting the cases this gate covers. */
  scope: z.string().min(1),
  require: GateRequirement,
});

export const SignOff = z.strictObject({
  role: z.string().min(1),
  people: z.array(Email).min(1),
});

/** `context/releases/policy.yaml`. */
export const ReleasePolicy = z.strictObject({
  gates: z.array(Gate).min(1),
  sign_off: z.array(SignOff).optional(),
});

export type ReleasePolicy = z.infer<typeof ReleasePolicy>;
export type Gate = z.infer<typeof Gate>;
