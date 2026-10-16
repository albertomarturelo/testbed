import { normalizeProjectPath } from "../load/paths.js";
import type { LoadedProject, LoadedWorkspace } from "../load/workspace.js";
import type { Toolchain } from "../operations/extensions.js";
import type { CommonsLayer } from "../resolve/resolve.js";
import type { ProjectEntry } from "../schema/index.js";
import type { Finding } from "./finding.js";
import {
  crossFileLevel,
  environmentLevel,
  resolutionLevel,
  schemaLevel,
  workspaceLevel,
} from "./levels.js";

/** What `validate` checks; each part comes from its filesystem adapter. */
export type ValidationInput = {
  /** From `loadWorkspace`. */
  workspace: LoadedWorkspace;
  /** From `loadToolchain`. */
  toolchain: Toolchain;
  /** Commons of the installed extensions (`extensionLayers`); resolution needs them. */
  extensionLayers?: readonly CommonsLayer[];
};

/** One `projects` entry of `casefile.yaml` and what the loader read for it. */
export type ProjectScope = {
  /** Position in `casefile.yaml`, for `projects.<index>` fields. */
  index: number;
  entry: ProjectEntry;
  /** Absent when the loader left the project out (missing, outside, repeated path). */
  loaded: LoadedProject | undefined;
};

/**
 * One validation level. A level with an error stops the later ones for that
 * scope (ADR agent-driven-setup, point 5): an error in `workspace` stops every
 * project, an error in `project` stops that project only.
 */
export type Level = {
  name: string;
  workspace?: (input: ValidationInput) => Finding[];
  project?: (scope: ProjectScope, input: ValidationInput) => Finding[];
};

/** workspace → file schemas → cross-file → resolution → environment. */
export const LEVELS: readonly Level[] = [
  workspaceLevel,
  schemaLevel,
  crossFileLevel,
  resolutionLevel,
  environmentLevel,
];

/**
 * Runs the levels over a loaded workspace. Pure: the adapters build the input.
 * Findings come level by level, each level sorted by path, line, field and code,
 * so the output is deterministic.
 */
export function validateWorkspace(
  input: ValidationInput,
  levels: readonly Level[] = LEVELS,
): Finding[] {
  const findings: Finding[] = [];
  let open = scopes(input.workspace);
  for (const level of levels) {
    const global = level.workspace?.(input) ?? [];
    const found = [...global];
    const stopped = hasError(global);
    if (!stopped && level.project !== undefined) {
      const check = level.project;
      open = open.filter((scope) => {
        const own = check(scope, input);
        found.push(...own);
        return !hasError(own);
      });
    }
    findings.push(...found.sort(byLocation));
    if (stopped) break;
  }
  return findings;
}

function scopes({ config, projects }: LoadedWorkspace): ProjectScope[] {
  return (config?.projects ?? []).map((entry, index) => {
    const path = normalizeProjectPath(entry.path);
    const loaded = projects.find((p) => p.name === entry.name && p.path === path);
    return { index, entry, loaded };
  });
}

function hasError(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}

function byLocation(a: Finding, b: Finding): number {
  return (
    compare(a.path, b.path) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    compare(a.field ?? "", b.field ?? "") ||
    compare(a.code, b.code) ||
    compare(a.message, b.message)
  );
}

/** Code-unit order, not locale order: the same on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
