import { type CasefileError, fail, ok, type Result } from "../errors.js";
import type { LoadedCase } from "../load/parse.js";
import { TESTS_DIR } from "../load/paths.js";
import type { LoadedRepo } from "../load/repo.js";
import type { CommonFile, HistoryEntry, RunEvent, TestCaseFile } from "../schema/index.js";

/** One level of inherited defaults, outermost first. */
export type CommonsLayer = {
  /** Repo-relative path of a `_common.yaml`, or `ext:<package>@<version>` (ADR org-commons-via-extension). */
  origin: string;
  commons: CommonFile;
};

type StoredAutomation = NonNullable<TestCaseFile["automation"]>;
type StoredAutomationStatus = NonNullable<StoredAutomation["status"]>;

/** Stored statuses plus the ones derived from run events (ADR write-ownership). */
export type AutomationStatus = StoredAutomationStatus | "automated" | "flaky";

/** A history entry with its commit derived from `change` (ADR history-commit-reference). */
export type ResolvedHistoryEntry = HistoryEntry & { commit: string | null };

/**
 * A case after commons inheritance and derivations. Not a file: it has no schema
 * (ADR schemas-generated-from-zod), only this type.
 */
export type ResolvedCase = Omit<
  TestCaseFile,
  "surfaces" | "layer" | "priority" | "automation" | "labels" | "preconditions" | "data" | "history"
> & {
  /** Repo-relative path of the case file. */
  path: string;
  surfaces: NonNullable<TestCaseFile["surfaces"]>;
  layer: NonNullable<TestCaseFile["layer"]>;
  priority: NonNullable<TestCaseFile["priority"]>;
  automation: { eligible: boolean; status: AutomationStatus; ref?: string };
  labels: NonNullable<TestCaseFile["labels"]>;
  preconditions: string[];
  data: NonNullable<TestCaseFile["data"]>;
  history: ResolvedHistoryEntry[];
  /**
   * Where each inheritable value came from, keyed by field: `surfaces`, `layer`,
   * `priority`, `automation.eligible`, `labels.<key>`, `data.<key>`,
   * `preconditions.<index>`. Values are commons origins or the case path.
   */
  origins: Record<string, string>;
};

export type ResolveContext = {
  /** Extension and repo commons, outermost first; see `commonsChain`. */
  layers: readonly CommonsLayer[];
  runs: readonly RunEvent[];
  /** Commit whose message carries `Casefile-Change: <change>`, or `null` (git adapter: #10). */
  commitFor: (change: string) => string | null;
};

const REQUIRED = ["surfaces", "layer", "priority", "automation.eligible"] as const;

/** Executors whose runs prove a case is automated: CI and agents, never humans. */
const AUTOMATED_EXECUTOR = /^(ci|agent):/;

/**
 * Applies commons inheritance (scalars override, `preconditions` prepended,
 * `labels`/`data` merged per key) and derives `automation.status` and
 * `history[].commit`.
 */
export function resolveCase(loaded: LoadedCase, context: ResolveContext): Result<ResolvedCase> {
  const { path, file } = loaded;
  const origins: Record<string, string> = {};
  const merged: {
    surfaces?: ResolvedCase["surfaces"];
    layer?: ResolvedCase["layer"];
    priority?: ResolvedCase["priority"];
    eligible?: boolean;
    labels: ResolvedCase["labels"];
    data: ResolvedCase["data"];
    preconditions: string[];
  } = { labels: {}, data: {}, preconditions: [] };

  const levels = [...context.layers, { origin: path, commons: file }];
  for (const { origin, commons } of levels) {
    if (commons.surfaces !== undefined) {
      merged.surfaces = [...commons.surfaces];
      origins.surfaces = origin;
    }
    if (commons.layer !== undefined) {
      merged.layer = commons.layer;
      origins.layer = origin;
    }
    if (commons.priority !== undefined) {
      merged.priority = commons.priority;
      origins.priority = origin;
    }
    if (commons.automation?.eligible !== undefined) {
      merged.eligible = commons.automation.eligible;
      origins["automation.eligible"] = origin;
    }
    for (const [key, value] of Object.entries(commons.labels ?? {})) {
      merged.labels[key] = value;
      origins[`labels.${key}`] = origin;
    }
    for (const [key, value] of Object.entries(commons.data ?? {})) {
      merged.data[key] = value;
      origins[`data.${key}`] = origin;
    }
    for (const precondition of commons.preconditions ?? []) {
      origins[`preconditions.${merged.preconditions.length}`] = origin;
      merged.preconditions.push(precondition);
    }
  }

  const { surfaces, layer, priority, eligible } = merged;
  if (
    surfaces === undefined ||
    layer === undefined ||
    priority === undefined ||
    eligible === undefined
  ) {
    const values = { surfaces, layer, priority, "automation.eligible": eligible };
    return fail(
      ...REQUIRED.filter((field) => values[field] === undefined).map(
        (field): CasefileError => ({
          code: "resolve.missing_field",
          path,
          field,
          message: `\`${field}\` is set neither in the case nor in any commons it inherits`,
        }),
      ),
    );
  }

  const ref = file.automation?.ref;
  return ok({
    ...file,
    path,
    surfaces,
    layer,
    priority,
    automation: {
      eligible,
      status: automationStatus(file.automation, context.runs),
      ...(ref === undefined ? {} : { ref }),
    },
    labels: merged.labels,
    preconditions: merged.preconditions,
    data: merged.data,
    history: file.history.map((entry) => ({ ...entry, commit: context.commitFor(entry.change) })),
    origins,
  });
}

/**
 * `automated` when any CI or agent run event carries the case's `automation.ref`,
 * whatever its status (automated ≠ passing). A `retired` automation stays retired.
 * `flaky` is not derived yet: no rule for it is fixed.
 */
function automationStatus(
  automation: StoredAutomation | undefined,
  runs: readonly RunEvent[],
): AutomationStatus {
  const stored = automation?.status ?? "manual";
  const ref = automation?.ref;
  if (stored === "retired" || ref === undefined) return stored;
  const proven = runs.some(
    (run) => run.automation_ref === ref && AUTOMATED_EXECUTOR.test(run.executor),
  );
  return proven ? "automated" : stored;
}

/**
 * Repo commons that apply to a case, root first: `context/tests/_common.yaml`,
 * then one per folder down to the case's own folder. The tree is the file's
 * location, not its `feature` field (the validator checks they agree, #9).
 */
export function commonsChain(
  commons: ReadonlyMap<string, CommonFile>,
  casePath: string,
): CommonsLayer[] {
  const folders = casePath
    .slice(TESTS_DIR.length + 1)
    .split("/")
    .slice(0, -1);
  const dirs = folders.map((_, i) => `${TESTS_DIR}/${folders.slice(0, i + 1).join("/")}`);
  return [TESTS_DIR, ...dirs].flatMap((dir) => {
    const origin = `${dir}/_common.yaml`;
    const found = commons.get(origin);
    return found === undefined ? [] : [{ origin, commons: found }];
  });
}

/** The commons layer an extension package contributes (ADR org-commons-via-extension). */
export function extensionLayer(name: string, version: string, commons: CommonFile): CommonsLayer {
  return { origin: `ext:${name}@${version}`, commons };
}

export type ResolvedRepo = { cases: ResolvedCase[]; errors: CasefileError[] };

/** Resolves every loaded case; extension layers go before the repo's own commons. */
export function resolveRepo(
  repo: LoadedRepo,
  options: Pick<ResolveContext, "commitFor"> & { extensionLayers?: readonly CommonsLayer[] },
): ResolvedRepo {
  const resolved: ResolvedRepo = { cases: [], errors: [] };
  for (const loaded of repo.cases) {
    const layers = [...(options.extensionLayers ?? []), ...commonsChain(repo.commons, loaded.path)];
    const result = resolveCase(loaded, { layers, runs: repo.runs, commitFor: options.commitFor });
    if (result.ok) resolved.cases.push(result.value);
    else resolved.errors.push(...result.errors);
  }
  return resolved;
}
