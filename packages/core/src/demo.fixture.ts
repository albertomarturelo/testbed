import { fileURLToPath } from "node:url";

/** Absolute path of `examples/demo-repo`, the shared fixture (CONVENTIONS #6). */
export const DEMO_ROOT = fileURLToPath(new URL("../../../examples/demo-repo/", import.meta.url));

/**
 * What the demo is designed to produce. Later issues assert against this
 * oracle instead of re-deriving it: resolver (#7), DSL (#8), gates (#10), CLI (#11).
 * Keep in sync with examples/demo-repo/README.md.
 */
export const DEMO_EXPECTED = {
  /** The single project of the workspace, at `.`. */
  project: "web",
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
    /** The `smoke` gate scope of `releases/policy.yaml`. */
    "labels.smoke = true AND state = active": ["TC-0001", "TC-0007"],
    "work_items CONTAINS release:web-1.2.0": ["TC-0001", "TC-0003", "TC-0004"],
  },
  /** Gate verdicts for `release:web-1.2.0` (all runs are on build `web-1.2.0+101`). */
  gates: { smoke: "red", "payments-regression": "green", auth: "green" },
  runFiles: 2,
  inboxItems: 1,
} as const;

/** Absolute path of `examples/demo-monorepo`, the two-project workspace fixture. */
export const DEMO_MONOREPO_ROOT = fileURLToPath(
  new URL("../../../examples/demo-monorepo/", import.meta.url),
);

/** What the monorepo demo is designed to produce. Keep in sync with its README. */
export const DEMO_MONOREPO_EXPECTED = {
  /** Project name → workspace-relative path, in `casefile.yaml` order. */
  projects: { web: "apps/web", api: "services/api" },
  caseRefs: ["api/TC-0001", "web/TC-0001", "web/TC-0002"],
  derivedAutomated: ["api/TC-0001", "web/TC-0001"],
  /** Commons `web/TC-0001` inherits from, outermost first. */
  webTc0001CommonsChain: ["casefile.yaml", "apps/web/context/tests/_common.yaml"],
  /** Feature and latest run of each case, as `overview` lists them; `null`: never ran. */
  overview: {
    "api/TC-0001": { feature: "orders", last_run: "passed", last_run_at: "2026-10-14T07:05:00Z" },
    "web/TC-0001": { feature: "login", last_run: "passed", last_run_at: "2026-10-14T07:00:00Z" },
    "web/TC-0002": { feature: "login", last_run: null, last_run_at: null },
  },
} as const;

/** Absolute path of `examples/npm-login`, the first real case (#35). */
export const NPM_LOGIN_ROOT = fileURLToPath(
  new URL("../../../examples/npm-login/", import.meta.url),
);

/**
 * What the npm-login example holds, as the real flow produced it (setup skill,
 * `qa-cover login`, one Playwright run ingested). Keep in sync with its README.
 */
export const NPM_LOGIN_EXPECTED = {
  project: "npm-login",
  caseIds: [
    "TC-0001",
    "TC-0002",
    "TC-0003",
    "TC-0004",
    "TC-0005",
    "TC-0006",
    "TC-0007",
    "TC-0008",
    "TC-0009",
  ],
  /** Every case is a draft waiting for review. */
  states: { draft: 9 },
  /** Front-end cases, linked to a test in `e2e/login.spec.ts` and proven by the ingested run. */
  derivedAutomated: ["TC-0001", "TC-0002", "TC-0003", "TC-0004", "TC-0005", "TC-0006"],
  /** Cases that need an account: manual, `automation.eligible: false`. */
  manualNotEligible: ["TC-0007", "TC-0008", "TC-0009"],
  /**
   * Latest result of the run `local-2026-10-17-1`. Each failure has its own cause
   * (#76): TC-0006 met a Cloudflare challenge (the environment, #67), TC-0002's
   * Sign In is disabled while empty (the case was wrong, #77), and TC-0003's field
   * became `type="input"` (the test was too strict).
   */
  lastRun: {
    "TC-0001": "passed",
    "TC-0002": "failed",
    "TC-0003": "failed",
    "TC-0004": "passed",
    "TC-0005": "passed",
    "TC-0006": "failed",
  },
  /**
   * Run events per case, newest first in `casefile runs`: the failures were
   * ingested again after #68 with their notes (ADR run-event-note §6), so they
   * have the noted event on top of the first one.
   */
  runCount: {
    "TC-0001": 1,
    "TC-0002": 2,
    "TC-0003": 2,
    "TC-0004": 1,
    "TC-0005": 1,
    "TC-0006": 2,
    "TC-0007": 0,
  },
  /**
   * Text in each failure's latest note. The page itself is in the attachment
   * below: only TC-0006's snapshot is the challenge page; TC-0002's is the form
   * with Sign In disabled.
   */
  failureNotes: {
    "TC-0002": "Test timeout of 30000ms exceeded.",
    "TC-0003": 'Received: "input"',
    "TC-0006": "Error: element(s) not found",
  },
  /** Playwright's page snapshot of each failure, kept as `attachment` evidence. */
  failureAttachments: {
    "TC-0002": "test-results/login-blocks-an-empty-submit-in-the-browser-chromium/error-context.md",
    "TC-0003":
      "test-results/login-masks-the-password-and-shows-it-on-request-chromium/error-context.md",
    "TC-0006":
      "test-results/login-links-to-password-recovery-and-sign-up-chromium/error-context.md",
  },
} as const;
