import { posix } from "node:path";
import { CONFIG_FILE, normalizeProjectPath, pathContains, TESTS_DIR } from "../load/paths.js";
import type { LoadedProject, LoadedWorkspace } from "../load/workspace.js";
import type { ProjectEntry } from "../schema/index.js";
import { type Finding, finding, fromError } from "./finding.js";

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
  workspace?: (workspace: LoadedWorkspace) => Finding[];
  project?: (scope: ProjectScope, workspace: LoadedWorkspace) => Finding[];
};

/** `casefile.yaml` and the projects it lists. */
export const workspaceLevel: Level = {
  name: "workspace",
  workspace({ config, errors }) {
    // Without a config the loader stopped: its errors are all about casefile.yaml.
    if (config === null) return errors.map(fromError);
    if (config.projects.length > 0) return [];
    return [
      finding("workspace.no_projects", {
        path: CONFIG_FILE,
        field: "projects",
        message: "casefile.yaml lists no projects; a workspace needs at least one",
      }),
    ];
  },
  project({ index, entry, loaded }, { config, errors }) {
    const field = `projects.${index}`;
    const found = errors
      .filter((e) => e.path === CONFIG_FILE && e.field?.startsWith(`${field}.`))
      .map(fromError);
    const path = normalizeProjectPath(entry.path);
    const earlier = (config?.projects ?? []).slice(0, index);
    const sameName = earlier.find((p) => p.name === entry.name);
    if (sameName !== undefined) {
      found.push(
        finding("project.duplicate_name", {
          path: CONFIG_FILE,
          field: `${field}.name`,
          message: `project name '${entry.name}' is already used by projects.${earlier.indexOf(sameName)}`,
        }),
      );
    }
    const samePath = earlier.find((p) => normalizeProjectPath(p.path) === path);
    if (samePath !== undefined) {
      found.push(
        finding("project.duplicate_path", {
          path: CONFIG_FILE,
          field: `${field}.path`,
          message: `${entry.path} is the directory of project '${samePath.name}' (${samePath.path})`,
        }),
      );
    }
    const nesting = earlier.find((p) => {
      const other = normalizeProjectPath(p.path);
      return other !== path && (pathContains(other, path) || pathContains(path, other));
    });
    if (nesting !== undefined) {
      found.push(
        finding("project.nested", {
          path: CONFIG_FILE,
          field: `${field}.path`,
          message: `project '${entry.name}' at ${path} and project '${nesting.name}' at ${normalizeProjectPath(nesting.path)} nest`,
        }),
      );
    }
    if (loaded !== undefined && !loaded.hasTestsDir) {
      found.push(
        finding("project.tests_missing", {
          path: CONFIG_FILE,
          field: `${field}.path`,
          message: `project '${entry.name}' has no ${posix.join(path, TESTS_DIR)}/ directory`,
        }),
      );
    }
    return found;
  },
};

/** Every file the loader read in a project parses and matches its schema. */
export const schemaLevel: Level = {
  name: "schema",
  project({ loaded }, { errors }) {
    if (loaded === undefined) return [];
    const prefix = `${posix.join(loaded.path, TESTS_DIR)}/`;
    return errors.filter((e) => e.path?.startsWith(prefix)).map(fromError);
  },
};

/** The levels in order; cross-file, resolution and environment follow (#40). */
export const LEVELS: readonly Level[] = [workspaceLevel, schemaLevel];

/**
 * Runs the levels over a loaded workspace. Pure: `loadWorkspace` is the adapter.
 * Findings come level by level, each level sorted by path, line, field and code,
 * so the output is deterministic.
 */
export function validateWorkspace(
  workspace: LoadedWorkspace,
  levels: readonly Level[] = LEVELS,
): Finding[] {
  const findings: Finding[] = [];
  let open = scopes(workspace);
  for (const level of levels) {
    const global = level.workspace?.(workspace) ?? [];
    const found = [...global];
    const stopped = hasError(global);
    if (!stopped && level.project !== undefined) {
      const check = level.project;
      open = open.filter((scope) => {
        const own = check(scope, workspace);
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
