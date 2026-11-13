import type { CasefileError } from "../errors.js";

export type Severity = "error" | "warning";

/**
 * One problem `validate` reports (ADR agent-driven-setup, point 5): enough for an
 * agent to fix it without asking. `path` is workspace-relative and always set.
 */
export type Finding = Omit<CasefileError, "path"> & {
  severity: Severity;
  path: string;
  /** What a valid value looks like, when it is not obvious from `message`. */
  expected?: string;
  /** How to fix it. */
  hint?: string;
  /** SPEC topic to read, for `casefile spec <topic>`. */
  spec?: string;
};

export type FindingCodeInfo = {
  severity: Severity;
  /** One line: what the code means. */
  description: string;
  /** Added to every finding with this code. */
  hint?: string;
};

const ADD_PROJECT = "register it with `casefile project add <name> --path <path>`";

/**
 * Every code `validate` can report, with its severity (input for
 * `casefile spec errors`, #27). Codes are stable: rename one only with a new code.
 */
export const FINDING_CODES = {
  "config.missing": {
    severity: "error",
    description: "`casefile.yaml` is missing at the workspace root",
    hint: "the human runs `casefile init`",
  },
  "config.commit_subject": {
    severity: "error",
    description:
      "`commit.subject` in `casefile.yaml` does not name `{summary}`, or names an unknown placeholder",
    hint: "use `{type}`, `{scope}`, `{summary}` and `{ticket}` only, e.g. `[{ticket}] {type}({scope}): {summary}`",
  },
  "config.commit_ticket_regex": {
    severity: "error",
    description: "`commit.ticket_from_branch` in `casefile.yaml` is not a valid regular expression",
  },
  "config.commit_ticket_default": {
    severity: "error",
    description: "`commit.ticket_default` in `casefile.yaml` is not one token a subject can carry",
    hint: "letters, digits and ._#/- only, e.g. `NO-TICKET`",
  },
  "yaml.invalid": {
    severity: "error",
    description: "A YAML file or case frontmatter does not parse",
  },
  "schema.invalid": {
    severity: "error",
    description: "A file does not match the schema of its format",
  },
  "scaffold.todo": {
    severity: "error",
    description: "A field still holds the `TODO` marker the scaffold left for a decision",
    hint: "replace `TODO` with a value; the scaffold's comment above the field lists the allowed ones",
  },
  "frontmatter.missing": {
    severity: "error",
    description: "A case file does not start with a `---` line",
  },
  "frontmatter.unclosed": {
    severity: "error",
    description: "A case file's frontmatter has no closing `---` line",
  },
  "json.invalid": {
    severity: "error",
    description: "A line of a run file is not valid JSON",
  },
  "workspace.no_projects": {
    severity: "error",
    description: "`casefile.yaml` lists no projects",
    hint: `${ADD_PROJECT} for each project of the repo`,
  },
  "project.outside_workspace": {
    severity: "error",
    description: "A project path is absolute or leaves the workspace",
    hint: "use a POSIX path relative to `casefile.yaml` that stays inside it",
  },
  "project.missing": {
    severity: "error",
    description: "A project path is not a directory",
  },
  "project.nested": {
    severity: "error",
    description: "A project directory lies inside another project's",
    hint: "projects do not nest; keep one of them",
  },
  "project.duplicate_name": {
    severity: "error",
    description: "Two projects share a name",
    hint: "project names are unique; rename or remove one entry",
  },
  "project.duplicate_path": {
    severity: "error",
    description: "Two projects point to the same directory",
    hint: "remove one entry; paths are compared after normalization",
  },
  "project.tests_missing": {
    severity: "error",
    description: "A project has no `context/tests/` directory",
    hint: `${ADD_PROJECT} to scaffold it`,
  },
  "case.feature_mismatch": {
    severity: "error",
    description: "A case's `feature` does not mirror its folder under `context/tests/`",
    hint: "set `feature` to the folder path, or move the file to the feature's folder",
  },
  "case.duplicate_id": {
    severity: "error",
    description: "Two cases of one project share an id",
    hint: "ids are unique per project; give one of them the next free id",
  },
  "label.undeclared": {
    severity: "error",
    description: "A label key is not declared in the project's `_properties.yaml`",
  },
  "run.unknown_case": {
    severity: "error",
    description: "A run event's `case_id` is not a case of its project",
    hint: "run files are append-only: restore the case, or record the correction as a new event",
  },
  "policy.invalid_scope": {
    severity: "error",
    description:
      "A gate's `scope` in `releases/policy.yaml` does not parse, or names a variable gates do not define",
    hint: "fix the query (`casefile spec query-grammar`); gate scopes may read `milestone.name` and `milestone.build` (or `release.*`)",
  },
  "run.undeclared_milestone": {
    severity: "warning",
    description:
      "Run events name a milestone that no `context/milestones/<slug>.yaml` declares (before `0.2.0`, a free-text release)",
    hint: "open it with the same slug (`casefile milestone open <slug> --title <title>`) to group those executions",
  },
  "dashboard.duplicate_widget": {
    severity: "error",
    description: "Two widgets of one dashboard share an `id`",
    hint: "save the dashboard again with unique widget ids (`casefile spec dashboard`)",
  },
  "dashboard.unknown_milestone": {
    severity: "error",
    description: "A dashboard widget names a milestone its project does not declare",
    hint: "open the milestone, or save the dashboard again without it (`casefile spec dashboard`)",
  },
  "dashboard.invalid_query": {
    severity: "error",
    description:
      "A dashboard widget's `query` does not parse, or reads `milestone.*` without naming a milestone",
    hint: "save the dashboard again with the query fixed (`casefile spec query-grammar`, `casefile spec dashboard`)",
  },
  "resolve.missing_field": {
    severity: "error",
    description: "A required field is set neither in the case nor in any commons it inherits",
    hint: "set it in the case or in a `_common.yaml` above it",
  },
  "extension.not_installed": {
    severity: "error",
    description:
      "An extension listed in `casefile.yaml` is not installed in `.casefile/node_modules`, or not at its pinned version",
  },
  "toolchain.not_installed": {
    severity: "error",
    description:
      "`.casefile/package.json` declares casefile but it is not installed, or not at its pinned version",
    hint: "npm install --prefix .casefile --ignore-scripts (in CI: npm ci --prefix .casefile --ignore-scripts); without the npm registry, unpack the release's casefile-toolchain-<version>.tgz into .casefile (casefile spec setup)",
  },
  "toolchain.unpinned": {
    severity: "warning",
    description: "`.casefile/package.json` does not pin casefile to an exact version",
    hint: "set `dependencies.casefile` to an exact version, then reinstall",
  },
} as const satisfies Record<string, FindingCodeInfo>;

export type FindingCode = keyof typeof FINDING_CODES;

/** A finding raised by a validator rule. */
export function finding(
  code: FindingCode,
  at: Omit<Finding, "code" | "severity" | "hint"> & { hint?: string },
): Finding {
  const info: FindingCodeInfo = FINDING_CODES[code];
  const hint = at.hint ?? info.hint;
  return { code, severity: info.severity, ...at, ...(hint === undefined ? {} : { hint }) };
}

/** A loader error as a finding; a code missing from the catalogue counts as an error. */
export function fromError(error: CasefileError): Finding {
  const info: FindingCodeInfo | undefined = FINDING_CODES[error.code as FindingCode];
  return {
    ...error,
    severity: info?.severity ?? "error",
    path: error.path ?? ".",
    ...(info?.hint === undefined ? {} : { hint: info.hint }),
  };
}
