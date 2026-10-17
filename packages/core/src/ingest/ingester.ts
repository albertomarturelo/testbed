import { z } from "zod";
import type { Result } from "../errors.js";
import { RunEvent } from "../schema/index.js";

/**
 * One test's result as an ingester reads it from a report (ADR
 * ingester-contract §1): keyed by `ref`, the `automation.ref` it matches. Core
 * adds the case, run and executor when it turns results into run events.
 */
export const IngestedResult = RunEvent.pick({
  status: true,
  duration_ms: true,
  evidence: true,
}).extend({
  ref: z.string().min(1),
  /** When the test ran; absent: the ingestion time. */
  at: RunEvent.shape.at.optional(),
  /**
   * Where in the report the result comes from when a test can report more than
   * once (a Playwright project): kept as evidence when results are merged.
   */
  source: z.string().min(1).optional(),
});

export type IngestedResult = z.infer<typeof IngestedResult>;

export type IngestContext = {
  /** Workspace-relative path of the report, for error locations. */
  path: string;
};

/**
 * A result format (ADR extension-model, ingester-contract). Hosts register it
 * as the operation `ingest-<format>` through `ingestOperation`; built-ins and
 * extensions (`manifest.ingesters`) the same way.
 */
export type Ingester = {
  /** Slug: `junit` → `casefile ingest junit <report>`. */
  format: string;
  /** SPEC path, relative to the declaring package; it cites `casefile spec ingest`. */
  spec: string;
  /** Reads the report text (UTF-8); errors are values with line and column. */
  parse(
    text: string,
    context: IngestContext,
  ): Result<IngestedResult[]> | Promise<Result<IngestedResult[]>>;
};

/** Declares an ingester; `ingestOperation` checks it when the host registers it. */
export function defineIngester(ingester: Ingester): Ingester {
  return Object.freeze({ ...ingester });
}
