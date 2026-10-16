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

const ADD_PROJECT = "register it with `casefile project add <name> <path>`";

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
  "resolve.missing_field": {
    severity: "error",
    description: "A required field is set neither in the case nor in any commons it inherits",
    hint: "set it in the case or in a `_common.yaml` above it",
  },
  "extension.not_installed": {
    severity: "error",
    description:
      "An extension listed in `casefile.yaml` is not installed in `.casefile/node_modules`",
  },
  "toolchain.not_installed": {
    severity: "error",
    description: "`.casefile/package.json` declares casefile but it is not installed",
    hint: "npm install --prefix .casefile --ignore-scripts (in CI: npm ci --prefix .casefile --ignore-scripts)",
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
