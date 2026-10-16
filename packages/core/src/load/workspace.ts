import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import type { CommonFile, Config, ProjectEntry, RunEvent } from "../schema/index.js";
import {
  type LoadedCase,
  parseCaseFile,
  parseCommonFile,
  parseConfigFile,
  parseRunFile,
} from "./parse.js";
import { CONFIG_FILE, normalizeProjectPath, TESTS_DIR } from "./paths.js";

// Paths in loaded data are workspace-relative and POSIX (ADR workspace-and-projects).

/** One project's files: what the resolver needs. */
export type LoadedProject = {
  name: string;
  /** Workspace-relative path of the project directory; `.` for the root. */
  path: string;
  /** `_common.yaml` files keyed by path, e.g. `apps/web/context/tests/_common.yaml`. */
  commons: Map<string, CommonFile>;
  cases: LoadedCase[];
  runs: RunEvent[];
};

export type LoadedWorkspace = {
  /** Absolute path of the directory holding `casefile.yaml`. */
  root: string;
  config: Config | null;
  /** In `casefile.yaml` order; projects whose directory is missing are left out. */
  projects: LoadedProject[];
  /** Unreadable or invalid files; the rest of the workspace still loads. */
  errors: CasefileError[];
};

const CASE_FILE = /(?:^|\/)TC-[0-9]{4,}\.md$/;
const RUN_FILE = /^\.runs\/[^/]+\.jsonl$/;

/**
 * Filesystem adapter: reads `casefile.yaml` at `root`, then each project's
 * commons, cases and run events. `.inbox/` and `_properties.yaml` are not read here.
 */
export async function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  const workspace: LoadedWorkspace = { root, config: null, projects: [], errors: [] };

  const configText = await readText(join(root, CONFIG_FILE));
  if (configText === null) {
    workspace.errors.push({
      code: "config.missing",
      path: CONFIG_FILE,
      message: "casefile.yaml not found at the workspace root",
    });
    return workspace;
  }
  const config = parseConfigFile(CONFIG_FILE, configText);
  if (!config.ok) {
    workspace.errors.push(...config.errors);
    return workspace;
  }
  workspace.config = config.value;

  for (const [index, entry] of config.value.projects.entries()) {
    const field = `projects.${index}.path`;
    const path = normalizeProjectPath(entry.path);
    if (isAbsolute(entry.path) || path === ".." || path.startsWith("../")) {
      workspace.errors.push({
        code: "project.outside_workspace",
        path: CONFIG_FILE,
        field,
        message: `project '${entry.name}' points outside the workspace: ${entry.path}`,
      });
      continue;
    }
    if (!(await isDirectory(join(root, path)))) {
      workspace.errors.push({
        code: "project.missing",
        path: CONFIG_FILE,
        field,
        message: `project '${entry.name}' points to ${entry.path}, which is not a directory`,
      });
      continue;
    }
    const project = await loadProject(root, { name: entry.name, path });
    workspace.projects.push(project.value);
    workspace.errors.push(...project.errors);
  }
  return workspace;
}

/**
 * Reads one project; errors are returned next to whatever loaded. `entry.path`
 * is normalized but not checked: the caller must keep it inside the workspace,
 * as `loadWorkspace` does (`project.outside_workspace`).
 */
export async function loadProject(
  root: string,
  entry: ProjectEntry,
): Promise<{ value: LoadedProject; errors: CasefileError[] }> {
  const projectPath = normalizeProjectPath(entry.path);
  const project: LoadedProject = {
    name: entry.name,
    path: projectPath,
    commons: new Map(),
    cases: [],
    runs: [],
  };
  const errors: CasefileError[] = [];
  const collect = <T>(result: Result<T>, use: (value: T) => void) => {
    if (result.ok) use(result.value);
    else errors.push(...result.errors);
  };

  const testsDir = posix.join(projectPath, TESTS_DIR);
  for (const rel of await listFiles(join(root, testsDir))) {
    if (rel.startsWith(".inbox/")) continue;
    const isCommon = rel === "_common.yaml" || rel.endsWith("/_common.yaml");
    const isRun = RUN_FILE.test(rel);
    if (!isCommon && !isRun && !CASE_FILE.test(rel)) continue;
    const path = posix.join(testsDir, rel);
    const text = await readText(join(root, path));
    if (text === null) continue;
    if (isCommon) collect(parseCommonFile(path, text), (c) => project.commons.set(path, c));
    else if (isRun) {
      const parsed = parseRunFile(path, text);
      project.runs.push(...parsed.events);
      errors.push(...parsed.errors);
    } else collect(parseCaseFile(path, text), (c) => project.cases.push(c));
  }
  return { value: project, errors };
}

/** The workspace root: the nearest directory at or above `cwd` holding `casefile.yaml`. */
export async function findWorkspaceRoot(cwd: string): Promise<Result<string>> {
  let dir = resolve(cwd);
  for (;;) {
    if ((await readText(join(dir, CONFIG_FILE))) !== null) return ok(dir);
    const parent = dirname(dir);
    if (parent === dir) {
      return fail({
        code: "workspace.missing",
        path: cwd,
        message: `no ${CONFIG_FILE} in ${resolve(cwd)} or any parent directory`,
      });
    }
    dir = parent;
  }
}

/**
 * The project containing `cwd`, or `null` when `cwd` is in none (e.g. the root
 * of a monorepo). Pure: `root` and `cwd` are only compared as paths.
 */
export function projectAt(
  projects: readonly ProjectEntry[],
  root: string,
  cwd: string,
): string | null {
  const rel = relative(resolve(root), resolve(cwd)).split(sep).join("/") || ".";
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return null;
  let found: { name: string; depth: number } | null = null;
  for (const { name, path } of projects) {
    const dir = normalizeProjectPath(path);
    const contains = dir === "." || rel === dir || rel.startsWith(`${dir}/`);
    const depth = dir === "." ? 0 : dir.split("/").length;
    if (contains && (found === null || depth > found.depth)) found = { name, depth };
  }
  return found?.name ?? null;
}

/** Files under `dir`, relative and POSIX, sorted; `[]` if `dir` does not exist. */
async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
