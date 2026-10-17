/** The local API (ADR local-ui-stack §2): each call runs one read-only core operation. */

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

export type ProjectSummary = { name: string; path: string; cases: number; unresolved: number };

export type CaseRow = {
  ref: string;
  project: string;
  feature: string;
  title: string;
  state: string;
  priority: string;
  automation: string;
  last_run: string | null;
  last_run_at: string | null;
};

export type Overview = { projects: ProjectSummary[]; cases: CaseRow[] };

export type Resolved = {
  ref: string;
  path: string;
  inherited: { field: string; value: string; origin: string }[];
  case: Record<string, unknown>;
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

export async function call<T>(name: string, input: object = {}): Promise<Result<T>> {
  try {
    const response = await fetch(`/api/operations/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return (await response.json()) as Result<T>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [{ code: "ui.unreachable", message: `no answer: ${message}` }] };
  }
}
