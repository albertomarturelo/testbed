/**
 * The local API (ADR local-ui-stack §2): each call runs one core operation.
 * Reads need nothing; a write carries the session token the server handed the
 * page (ADR human-writes-through-operations §3), and the server commits it as
 * the human.
 */

export type CasefileError = {
  code: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  field?: string;
  hint?: string;
  severity?: "error" | "warning";
};

export type Result<T> = { ok: true; value: T } | { ok: false; errors: CasefileError[] };

/** Who the QA acts as, and which source said so (ADR identity-override). */
export type SessionIdentity = { email: string; name?: string; source: "explicit" | "env" | "git" };

/**
 * Whether the repository's commit subject needs a ticket, and the one the
 * checked-out branch names (ADR commit-shape-follows-host-repo §3).
 */
export type SessionCommit = { ticket: boolean; branchTicket?: string };

export type Session = {
  token: string;
  identity: SessionIdentity | null;
  /** Absent from a server older than 0.2.0. */
  commit?: SessionCommit;
};

/** The commit a writing operation returned, with the sha the server made. */
export type Commit = { author?: string; message: string; files: string[]; sha: string };

export type ProjectSummary = { name: string; path: string; cases: number; unresolved: number };

export type CaseRow = {
  ref: string;
  project: string;
  feature: string;
  title: string;
  state: string;
  priority: string;
  automation: string;
  /** `automation.ref`, `null` when no test is linked. */
  automation_ref: string | null;
  eligible: boolean;
  last_run: string | null;
  last_run_at: string | null;
};

export type Overview = { projects: ProjectSummary[]; cases: CaseRow[] };

export type Resolved = {
  ref: string;
  path: string;
  /** The Markdown below the frontmatter; absent when the case has none (#86). */
  body?: string;
  inherited: { field: string; value: string; origin: string }[];
  case: Record<string, unknown>;
};

/** What `review` answers (`casefile spec review`): the case's new state and the commit made. */
export type Reviewed = {
  ref: string;
  path: string;
  change: string;
  state: string;
  changed: string[];
  events: string[];
  commit: Commit;
  next: string[];
};

/** What `cover` answers (`casefile spec cover`): the drafts it wrote and the commit made. */
export type Covered = {
  project: string;
  feature: string;
  change: string;
  created: { ref: string; path: string }[];
  commit: Commit;
  next: string[];
};

/**
 * What `run` answers (`casefile spec run`): the event and the commit the viewer
 * made. A retry of a result already recorded appends nothing and has no commit.
 */
export type Recorded = {
  ref: string;
  run: string;
  path: string;
  appended: boolean;
  event: { status: string };
  commit?: Commit;
  next: string[];
};

/** One line of a `.runs/*.jsonl` file, with that file (`casefile spec runs`). */
export type CaseRun = {
  run_id: string;
  case_id: string;
  status: string;
  executor: string;
  at: string;
  env?: string;
  build?: string;
  /** The milestone it belongs to (ADR milestones-group-executions). */
  milestone?: string;
  /** What run files from before `0.2.0` call the milestone. */
  release?: string;
  duration_ms?: number;
  evidence?: { kind: string; ref: string; sha256?: string }[];
  automation_ref?: string;
  /** Why the run ended as it did: a failure message, at most 2000 characters. */
  note?: string;
  path: string;
};

/** A case's run events, newest first. */
export type CaseRuns = { ref: string; runs: CaseRun[] };

/** Totals over a milestone's in-scope cases (ADR milestones-group-executions §4). */
export type EvidenceTotals = {
  in_scope: number;
  executed: number;
  passed: number;
  failed: number;
  blocked: number;
  not_run: number;
};

/** One row of `milestone-list` (`casefile spec milestone`). */
export type MilestoneRow = {
  project: string;
  slug: string;
  title: string;
  state: "open" | "closed";
  due: string | null;
  release: string | null;
  path: string;
  closed: { at: string; by: string } | null;
  /** `null` when it cannot be read: `milestone-report` says why. */
  totals: EvidenceTotals | null;
  red_gates: string[];
};

export type MilestoneList = { milestones: MilestoneRow[] };

/** A milestone's evidence as data: generated now while open, the frozen file once closed. */
export type EvidenceDocument = {
  project: string;
  slug: string;
  title: string;
  release: string | null;
  due: string | null;
  scope: string;
  build: string | null;
  opened: { at: string; by: string } | null;
  closed: { at: string; by: string } | null;
  totals: EvidenceTotals;
  /** `null` when the project has no release policy. */
  gates: { name: string; verdict: string; cases: number; reasons: string | null }[] | null;
  cases: {
    id: string;
    title: string;
    priority: string;
    result: "passed" | "failed" | "blocked" | null;
    executor: string | null;
    at: string | null;
    build: string | null;
    note: string | null;
    evidence: string[];
  }[];
  note: string | null;
};

/** What `milestone-report` answers. */
export type MilestoneReport = {
  project: string;
  slug: string;
  state: "open" | "closed";
  path: string;
  /** The evidence as Markdown. */
  evidence: string;
  /** Absent when a frozen file no longer has the shape core writes: show `evidence`. */
  report?: EvidenceDocument;
  /** Open only. */
  red_gates?: string[];
  next: string[];
};

/** What `milestone-open` answers, with the commit the viewer made. */
export type MilestoneOpened = {
  project: string;
  slug: string;
  path: string;
  change: string;
  commit: Commit;
  next: string[];
};

/** What `milestone-close` answers, with the commit the viewer made. */
export type MilestoneClosed = {
  project: string;
  slug: string;
  /** The frozen evidence file. */
  evidence: string;
  path: string;
  change: string;
  red_gates: string[];
  commit: Commit;
  next: string[];
};

/** One row of `dashboard-list` (`casefile spec dashboard`). */
export type DashboardRow = {
  project: string;
  slug: string;
  title: string;
  description: string | null;
  /** How many widgets it has. */
  widgets: number;
  path: string;
};

export type DashboardList = { dashboards: DashboardRow[] };

/** The statuses a `timeseries` day counts, in the order they stack. */
export const SERIES_STATUSES = ["passed", "failed", "blocked", "skipped", "not_run"] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

/** What one widget shows, as core computed it (ADR dashboards-as-files §5). */
export type WidgetData =
  | { type: "stat"; value: number }
  | {
      type: "bar" | "donut";
      /** Largest first; `(none)` last. */
      groups: { value: string; count: number }[];
      total: number;
    }
  | {
      type: "table";
      /** `id` first, then the widget's columns. */
      columns: string[];
      rows: { id: string; cells: string[] }[];
      /** The matching cases; `rows` holds the first `limit`. */
      total: number;
    }
  | {
      type: "timeseries";
      days: ({ date: string } & Record<SeriesStatus, number>)[];
      total: number;
    };

export type WidgetView = {
  id: string;
  title: string;
  type: "stat" | "bar" | "donut" | "table" | "timeseries";
  /** Columns of 12. */
  width: number;
  /** Absent when `error` says why it cannot be computed. */
  data?: WidgetData;
  error?: { code: string; message: string };
};

/** What `dashboard-show` answers: every widget with its data, computed now. */
export type DashboardShown = {
  project: string;
  slug: string;
  title: string;
  description: string | null;
  path: string;
  /** The day (UTC) the numbers were computed on. */
  date: string;
  widgets: WidgetView[];
};

export type QueryAnswer = {
  count: number;
  cases: { ref: string; state: string; priority: string; title: string }[];
  unresolved: number;
};

export type Validation = {
  projects: number;
  cases: number;
  warnings: number;
  findings: CasefileError[];
};

const TOKEN_HEADER = "x-casefile-token";

let sessionOnce: Promise<Session | null> | undefined;

/** Forget the session, as a new page load would (tests). */
export function forgetSession(): void {
  sessionOnce = undefined;
}

/**
 * The page's session, fetched once per load; `null` when the server did not
 * answer, in which case the next call asks again.
 */
export function session(): Promise<Session | null> {
  sessionOnce ??= fetch("/api/session")
    .then(async (response) => {
      const result = (await response.json()) as Result<Session>;
      return result.ok ? result.value : null;
    })
    .catch(() => null)
    .then((value) => {
      if (value === null) sessionOnce = undefined;
      return value;
    });
  return sessionOnce;
}

export async function call<T>(name: string, input: object = {}): Promise<Result<T>> {
  try {
    const token = (await session())?.token;
    const response = await fetch(`/api/operations/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { [TOKEN_HEADER]: token }) },
      body: JSON.stringify(input),
    });
    return (await response.json()) as Result<T>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [{ code: "ui.unreachable", message: `no answer: ${message}` }] };
  }
}
