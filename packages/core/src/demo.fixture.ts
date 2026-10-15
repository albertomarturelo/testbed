import { fileURLToPath } from "node:url";

/** Absolute path of `examples/demo-repo`, the shared fixture (CONVENTIONS #6). */
export const DEMO_ROOT = fileURLToPath(new URL("../../../examples/demo-repo/", import.meta.url));

/**
 * What the demo is designed to produce. Later issues assert against this
 * oracle instead of re-deriving it: resolver (#7), DSL (#8), gates (#10), CLI (#11).
 * Keep in sync with examples/demo-repo/README.md.
 */
export const DEMO_EXPECTED = {
  caseIds: ["TC-0001", "TC-0002", "TC-0003", "TC-0004", "TC-0005", "TC-0006", "TC-0007", "TC-0008"],
  states: { draft: 1, in_review: 1, active: 5, retired: 1 },
  topLevelFeatures: ["auth", "catalog", "checkout"],
  /** Commons files TC-0003 inherits from, root first. */
  tc0003CommonsChain: [
    "context/tests/_common.yaml",
    "context/tests/checkout/_common.yaml",
    "context/tests/checkout/payments/_common.yaml",
  ],
  /** Cases whose `automation.status` resolves to `automated` (a run matches `automation.ref`). */
  derivedAutomated: ["TC-0001", "TC-0004", "TC-0007"],
  queries: {
    "labels.risk = payments AND automation.status != automated": ["TC-0003", "TC-0005"],
  },
  /** Gate verdicts for `release:web-1.2.0` (all runs are on build `web-1.2.0+101`). */
  gates: { smoke: "red", "payments-regression": "green", auth: "green" },
  runFiles: 2,
  inboxItems: 1,
} as const;
