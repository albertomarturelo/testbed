import { z } from "zod";
import { fail, ok } from "../errors.js";
import type { LoadedProject } from "../load/workspace.js";
import { queryCases } from "../query/evaluate.js";
import { caseRef, type ResolvedCase } from "../resolve/resolve.js";
import type { RunEvent } from "../schema/index.js";
import { loadWorkspaceCases, selectProject } from "./cases.js";
import { defineOperation, type OperationContext } from "./operation.js";
import { validateOperation } from "./validate.js";

/** A GitHub PR comment holds at most 65,536 characters; a job summary more. */
export const REPORT_LIMIT = 65_536;

const ReportInput = z.strictObject({
  /** Only this project; filled by the host. Absent: every project. */
  project: z.string().min(1).optional().meta({ host: "project" }),
  /** Only the cases this query selects (`casefile spec query`). Absent: every case. */
  query: z.string().min(1).optional(),
});

const Count = z.number().int();

const ReportOutput = z.strictObject({
  /** The report as Markdown, at most {@link REPORT_LIMIT} characters. */
  markdown: z.string(),
  /** In `casefile.yaml` order. */
  projects: z.array(
    z.strictObject({
      name: z.string(),
      path: z.string(),
      cases: Count,
      drafts: Count,
      p0: Count,
      automated: Count,
      linked: Count,
      no_test: Count,
      not_eligible: Count,
      /** Cases whose latest run failed; `null` when the project has no run events. */
      failed: Count.nullable(),
    }),
  ),
  /** Every project together. */
  cases: z.strictObject({ total: Count, drafts: Count, p0: Count, failed: Count }),
  /** `casefile validate` over the same projects. */
  findings: z.strictObject({ errors: Count, warnings: Count }),
  /** Table rows and list lines cut to stay under the limit; 0 when nothing was. */
  left_out: Count,
});

/**
 * `casefile report` (#115): a Markdown summary of the workspace for a workflow's
 * job summary or a PR comment, with the counts as data. Read-only.
 */
export const reportOperation = defineOperation({
  name: "report",
  input: ReportInput,
  output: ReportOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/report.md",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const scope = selectProject(workspace, input.project);
    if (!scope.ok) return scope;
    const projects = workspace.projects.filter((p) => scope.value === null || p === scope.value);
    const names = new Set(projects.map((p) => p.name));
    let cases = resolved.cases.filter((c) => names.has(c.project));
    if (input.query !== undefined) {
      const matched = queryCases(input.query, cases);
      if (!matched.ok) return fail(...matched.errors.map((e) => ({ ...e, field: "query" })));
      cases = matched.value;
    }

    const reports = projects.map((project) =>
      projectReport(
        project,
        cases.filter((c) => c.project === project.name),
      ),
    );
    const findings = await validateCounts(input.project, context);
    const { markdown, left_out } = renderReport({
      ...(input.query === undefined ? {} : { query: input.query }),
      projects: reports,
      findings,
    });
    const sum = (pick: (p: ProjectReport) => number) =>
      reports.reduce((total, p) => total + pick(p), 0);
    return ok({
      markdown,
      projects: reports.map((p) => ({
        name: p.name,
        path: p.path,
        ...p.total,
        failed: p.hasRuns ? p.total.failed : null,
      })),
      cases: {
        total: sum((p) => p.total.cases),
        drafts: sum((p) => p.total.drafts),
        p0: sum((p) => p.total.p0),
        failed: sum((p) => p.total.failed),
      },
      findings,
      left_out,
    });
  },
});

/** One feature's counts; `automated` and `failed` come from runs. */
export type FeatureCounts = {
  cases: number;
  drafts: number;
  p0: number;
  automated: number;
  linked: number;
  no_test: number;
  not_eligible: number;
  failed: number;
};

/** A case in a list: its ref and title. */
export type ReportItem = { ref: string; title: string };

/** What the report says about one project, before it is rendered. */
export type ProjectReport = {
  name: string;
  path: string;
  /** The project has run events: the run columns and the failed list are shown. */
  hasRuns: boolean;
  /** Features in tree order. */
  features: (FeatureCounts & { feature: string })[];
  total: FeatureCounts;
  drafts: ReportItem[];
  failed: ReportItem[];
};

function projectReport(project: LoadedProject, cases: readonly ResolvedCase[]): ProjectReport {
  const latest = latestStatus(project);
  const byFeature = new Map<string, FeatureCounts>();
  const total = emptyCounts();
  const drafts: ReportItem[] = [];
  const failed: ReportItem[] = [];
  for (const c of cases) {
    const counts = byFeature.get(c.feature) ?? emptyCounts();
    byFeature.set(c.feature, counts);
    const kind = automationKind(c.automation);
    const lastFailed = latest.get(c.id) === "failed";
    for (const target of [counts, total]) {
      target.cases += 1;
      if (c.state === "draft") target.drafts += 1;
      if (c.priority === "P0") target.p0 += 1;
      if (kind !== null) target[kind] += 1;
      if (lastFailed) target.failed += 1;
    }
    if (c.state === "draft") drafts.push({ ref: caseRef(c), title: c.title });
    if (lastFailed) failed.push({ ref: caseRef(c), title: c.title });
  }
  return {
    name: project.name,
    path: project.path,
    hasRuns: project.runs.length > 0,
    features: [...byFeature]
      .sort(([a], [b]) => compareTree(a, b))
      .map(([feature, counts]) => ({ feature, ...counts })),
    total,
    drafts,
    failed,
  };
}

function emptyCounts(): FeatureCounts {
  return {
    cases: 0,
    drafts: 0,
    p0: 0,
    automated: 0,
    linked: 0,
    no_test: 0,
    not_eligible: 0,
    failed: 0,
  };
}

/**
 * The automation column a case counts in, as the viewer's badge reads it
 * (#111): proven by runs, linked to a test no run reported yet, nobody can
 * automate it, or it could be automated and has no test. `candidate`,
 * `in_progress` and `retired` count in none.
 */
function automationKind(
  automation: ResolvedCase["automation"],
): "automated" | "linked" | "not_eligible" | "no_test" | null {
  if (automation.status === "automated" || automation.status === "flaky") return "automated";
  if (automation.status === "retired") return null;
  if (automation.ref !== undefined && automation.ref !== null) return "linked";
  if (!automation.eligible) return "not_eligible";
  return automation.status === "manual" ? "no_test" : null;
}

/** Parents before children, siblings by name: `auth`, `auth/login`, `catalog`. */
function compareTree(a: string, b: string): number {
  const x = a.split("/");
  const y = b.split("/");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const order = (x[i] as string).localeCompare(y[i] as string);
    if (order !== 0) return order;
  }
  return x.length - y.length;
}

/** Each case id's latest run status by `at`; on a tie, the later line wins (as `overview`). */
function latestStatus(project: LoadedProject): Map<string, RunEvent["status"]> {
  const latest = new Map<string, { at: number; status: RunEvent["status"] }>();
  for (const { event } of project.runs) {
    const at = Date.parse(event.at);
    const current = latest.get(event.case_id);
    if (current === undefined || at >= current.at)
      latest.set(event.case_id, { at, status: event.status });
  }
  return new Map([...latest].map(([id, { status }]) => [id, status]));
}

async function validateCounts(
  project: string | undefined,
  context: OperationContext,
): Promise<{ errors: number; warnings: number }> {
  const result = await validateOperation.run(project === undefined ? {} : { project }, context);
  if (result.ok) return { errors: 0, warnings: result.value.warnings };
  const warnings = result.errors.filter(
    (e) => (e as { severity?: string }).severity === "warning",
  ).length;
  return { errors: result.errors.length - warnings, warnings };
}

/** A run of lines that may be cut: its rows, then a line saying how many were not shown. */
type Block = { head: string[]; rows: string[]; more: (n: number) => string; tail: string[] };

/**
 * The report as Markdown, cut to `limit` characters. Headings, table headers and
 * the closing line always stay; table rows and list lines are kept in reading
 * order while they fit, and every block that lost some ends with how many.
 */
export function renderReport(
  report: {
    query?: string;
    projects: readonly ProjectReport[];
    findings: { errors: number; warnings: number };
  },
  limit = REPORT_LIMIT,
): { markdown: string; left_out: number } {
  const blocks: Block[] = [
    {
      head: [
        "# casefile report",
        "",
        ...(report.query === undefined ? [] : [`Cases matching \`${code(report.query)}\`.`, ""]),
      ],
      rows: [],
      more: () => "",
      tail: [],
    },
    ...report.projects.flatMap(projectBlocks),
  ];
  const { errors, warnings } = report.findings;
  const closing = [
    `\`casefile validate\`: ${plural(errors, "error")}, ${plural(warnings, "warning")}.`,
  ];

  const fixed = blocks.flatMap((b) => [...b.head, ...b.tail]).concat(closing);
  // Each block that may lose rows keeps room for its "N more" line.
  const reserve = blocks
    .filter((b) => b.rows.length > 0)
    .reduce((sum, b) => sum + b.more(b.rows.length).length + 1, 0);
  let budget = limit - (length(fixed) + reserve);
  let full = true;
  let leftOut = 0;
  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(...block.head);
    let kept = 0;
    for (const row of block.rows) {
      if (!full || row.length + 1 > budget) {
        full = false;
        break;
      }
      lines.push(row);
      budget -= row.length + 1;
      kept += 1;
    }
    if (kept < block.rows.length) {
      lines.push(block.more(block.rows.length - kept));
      leftOut += block.rows.length - kept;
    }
    lines.push(...block.tail);
  }
  lines.push(...closing);
  return { markdown: `${lines.join("\n")}\n`, left_out: leftOut };
}

const COLUMNS: { key: keyof FeatureCounts; title: string; runs?: true }[] = [
  { key: "cases", title: "Cases" },
  { key: "drafts", title: "Drafts" },
  { key: "p0", title: "P0" },
  { key: "automated", title: "Automated", runs: true },
  { key: "linked", title: "Linked" },
  { key: "no_test", title: "No test" },
  { key: "not_eligible", title: "Not eligible" },
  { key: "failed", title: "Failed", runs: true },
];

function projectBlocks(project: ProjectReport): Block[] {
  const columns = COLUMNS.filter((c) => project.hasRuns || c.runs !== true);
  const row = (name: string, counts: FeatureCounts) =>
    `| ${name} | ${columns.map((c) => counts[c.key]).join(" | ")} |`;
  const table: Block = {
    head: [
      `## ${text(project.name)}`,
      "",
      `| Feature | ${columns.map((c) => c.title).join(" | ")} |`,
      `|---|${columns.map(() => "--:").join("|")}|`,
    ],
    rows: project.features.map((f) => row(text(f.feature || "(root)"), f)),
    more: (n) => `| _${plural(n, "more feature")} not shown_ |${" |".repeat(columns.length)}`,
    tail: [
      ...(project.features.length > 1 ? [row("**Total**", project.total)] : []),
      ...(project.features.length === 0 ? ["", "No cases."] : []),
      "",
    ],
  };
  const list = (title: string, items: readonly ReportItem[]): Block => ({
    head: [`### ${title} (${items.length})`, ""],
    rows: items.map((item) => `- \`${code(item.ref)}\` ${text(item.title)}`),
    more: (n) => `- _${n} more not shown_`,
    tail: [""],
  });
  return [
    table,
    ...(project.drafts.length > 0 ? [list("Drafts awaiting review", project.drafts)] : []),
    ...(project.hasRuns && project.failed.length > 0
      ? [list("Latest run failed", project.failed)]
      : []),
  ];
}

/** Case and repository text is data: one line, with Markdown's markup characters escaped. */
function text(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[\\`*_[\]<>|#]/g, "\\$&");
}

/** Text inside a code span: one line, no backtick that would close it. */
function code(value: string): string {
  return value.replace(/\s+/g, " ").replaceAll("`", "'");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function length(lines: readonly string[]): number {
  return lines.reduce((sum, line) => sum + line.length + 1, 0);
}
