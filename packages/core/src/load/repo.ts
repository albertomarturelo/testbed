import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { CasefileError, Result } from "../errors.js";
import type { CommonFile, Config, RunEvent } from "../schema/index.js";
import {
  type LoadedCase,
  parseCaseFile,
  parseCommonFile,
  parseConfigFile,
  parseRunFile,
} from "./parse.js";
import { CONFIG_FILE, TESTS_DIR } from "./paths.js";

/** Everything the resolver needs, read from a repo. Paths are repo-relative, POSIX. */
export type LoadedRepo = {
  root: string;
  config: Config | null;
  /** `_common.yaml` files keyed by path, e.g. `context/tests/checkout/_common.yaml`. */
  commons: Map<string, CommonFile>;
  cases: LoadedCase[];
  runs: RunEvent[];
  /** Unreadable or invalid files; the rest of the repo still loads. */
  errors: CasefileError[];
};

const CASE_FILE = /(?:^|\/)TC-[0-9]{4,}\.md$/;
const RUN_FILE = /^\.runs\/[^/]+\.jsonl$/;

/**
 * Filesystem adapter: reads `casefile.yaml`, commons, cases and run events under
 * `root`. `.inbox/` and `_properties.yaml` are not read here.
 */
export async function loadRepo(root: string): Promise<LoadedRepo> {
  const repo: LoadedRepo = {
    root,
    config: null,
    commons: new Map(),
    cases: [],
    runs: [],
    errors: [],
  };
  const collect = <T>(result: Result<T>, use: (value: T) => void) => {
    if (result.ok) use(result.value);
    else repo.errors.push(...result.errors);
  };

  const configText = await readText(root, CONFIG_FILE);
  if (configText === null) {
    repo.errors.push({
      code: "config.missing",
      path: CONFIG_FILE,
      message: "casefile.yaml not found",
    });
  } else {
    collect(parseConfigFile(CONFIG_FILE, configText), (config) => {
      repo.config = config;
    });
  }

  for (const rel of await listFiles(join(root, TESTS_DIR))) {
    const path = posix.join(TESTS_DIR, rel);
    if (rel.startsWith(".inbox/")) continue;
    const isCommon = rel === "_common.yaml" || rel.endsWith("/_common.yaml");
    if (!isCommon && !CASE_FILE.test(rel) && !RUN_FILE.test(rel)) continue;
    const text = await readText(root, path);
    if (text === null) continue;
    if (isCommon) collect(parseCommonFile(path, text), (c) => repo.commons.set(path, c));
    else if (RUN_FILE.test(rel)) {
      const { events, errors } = parseRunFile(path, text);
      repo.runs.push(...events);
      repo.errors.push(...errors);
    } else collect(parseCaseFile(path, text), (c) => repo.cases.push(c));
  }
  return repo;
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

async function readText(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
