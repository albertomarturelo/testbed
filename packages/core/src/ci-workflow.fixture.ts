import { parse } from "yaml";

// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not a template
const BRANCH_TIP = "${{ github.ref_name }}";

/**
 * What a GitHub Actions workflow from `casefile spec ci` must keep (ADR
 * ci-commits-run-files §4–§5), as problems; `[]` when it keeps them all. A
 * workflow with a `record` job is a tests workflow; any other must run
 * `casefile validate` on every push. Test-only: the SPEC template and the
 * npm-login example are checked by it, so neither drifts from the rules.
 */
export function workflowProblems(text: string): string[] {
  let workflow: Workflow | null;
  try {
    workflow = parse(text) as Workflow | null;
  } catch (error) {
    return [`not YAML: ${(error as Error).message}`];
  }
  if (workflow === null || typeof workflow !== "object") return ["not a workflow"];
  const push = workflow.on?.push;
  if (push === undefined || push === null) return ["no push trigger: nothing would be recorded"];
  const steps = (job: Job | undefined) => job?.steps ?? [];
  const scripts = (job: Job | undefined) => steps(job).map((step) => step.run ?? "");
  const record = workflow.jobs?.record;
  const problems: string[] = [];

  if (record === undefined) {
    if (push["paths-ignore"] !== undefined) problems.push("validate must not skip record commits");
    const jobs = Object.values(workflow.jobs ?? {});
    if (!jobs.some((job) => scripts(job).some((run) => /casefile validate\b/.test(run)))) {
      problems.push("no job runs casefile validate");
    }
    return problems;
  }

  if (!(push["paths-ignore"] ?? []).includes("**/context/tests/.runs/**")) {
    problems.push("the tests must ignore pushes that only touch **/context/tests/.runs/**");
  }
  if (record.needs === undefined) problems.push("record must need the test jobs");
  const condition = record.if ?? "";
  if (!condition.includes("always()")) problems.push("record must run when the tests failed");
  if (!condition.includes("github.event_name == 'push'")) {
    problems.push("record must not run on a pull request");
  }
  if (record.concurrency !== undefined) {
    problems.push("record must have no concurrency group: GitHub cancels pending jobs");
  }
  const checkout = steps(record).find((step) => step.uses?.startsWith("actions/checkout@"));
  if (checkout?.with?.ref !== BRANCH_TIP) {
    problems.push(`record must check out the branch tip (ref: ${BRANCH_TIP})`);
  }
  const script = scripts(record).join("\n");
  const required: [RegExp, string][] = [
    [/casefile ingest \S+/, "record must run casefile ingest"],
    [/--tested-commit "\$GITHUB_SHA"/, "ingest must pass --tested-commit"],
    [/--json/, "ingest must print --json, to read commit byte for byte"],
    [
      /user\.name=casefile-ci -c user\.email=casefile-ci@casefile\.invalid/,
      "commit as casefile-ci",
    ],
    [/commit -F \S+ -- /, "commit only the returned files (-- <paths>)"],
    [/git reset --hard/, "a rejected push resets to the new tip and ingests again"],
  ];
  for (const [pattern, problem] of required) if (!pattern.test(script)) problems.push(problem);
  if (/git (merge|rebase|pull)\b/.test(script)) problems.push("never resolve a conflict");
  return problems;
}

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  needs?: unknown;
  if?: string;
  concurrency?: unknown;
  steps?: Step[];
};
type Workflow = {
  on?: { push?: { "paths-ignore"?: string[] } | null };
  jobs?: Record<string, Job>;
};
