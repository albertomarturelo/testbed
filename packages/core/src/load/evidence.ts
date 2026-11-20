import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { evidenceRunFile, isCheckedEvidence, NOT_A_FILE } from "../operations/evidence.js";
import type { Evidence, EvidenceConfig } from "../schema/index.js";
import { parseConfigFile, parseRunFile } from "./parse.js";
import { CONFIG_FILE, normalizeProjectPath } from "./paths.js";
import type { LoadedWorkspace } from "./workspace.js";

/**
 * Filesystem adapter for the viewer's `GET /api/evidence` (ADR run-evidence-files
 * §7): the entry a run event names under `ref` as a file `run` stored (`image`,
 * `video`, `file`) inside a `.runs/<run-id>/` directory of the event's own
 * project, with the workspace's `evidence` config. Reads `casefile.yaml` and
 * only the run file that would name it, `.runs/<run-id>.jsonl`; `null` when no
 * event there does. It does not look at the stored file itself.
 */
export async function findNamedEvidence(
  root: string,
  ref: string,
): Promise<{ entry: Evidence; config: EvidenceConfig | undefined } | null> {
  const text = await readFile(join(root, CONFIG_FILE), "utf8").catch(() => null);
  const config = text === null ? null : parseConfigFile(CONFIG_FILE, text);
  if (config === null || !config.ok) return null;
  for (const project of config.value.projects) {
    const path = normalizeProjectPath(project.path);
    if (isAbsolute(project.path) || path === ".." || path.startsWith("../")) continue;
    const runFile = evidenceRunFile(ref, path);
    if (runFile === null) continue;
    const runText = await readFile(join(root, runFile), "utf8").catch(() => null);
    if (runText === null) continue;
    for (const { event } of parseRunFile(runFile, runText).runs) {
      for (const entry of event.evidence ?? []) {
        if (entry.ref === ref && isCheckedEvidence(entry, path)) {
          return { entry, config: config.value.evidence };
        }
      }
    }
  }
  return null;
}

/**
 * Filesystem adapter for `validate`: the SHA-256 of every stored evidence file
 * a run event names (ADR run-evidence-files §9), keyed by its workspace-relative
 * `ref`; `null` when nothing is there, `NOT_A_FILE` for a symlink, directory or
 * device (never followed). Files are streamed, never read whole. With
 * `project`, only that project's run events count.
 */
export async function hashStoredEvidence(
  workspace: LoadedWorkspace,
  project?: string,
): Promise<Map<string, string | null>> {
  const hashes = new Map<string, string | null>();
  for (const loaded of workspace.projects) {
    if (project !== undefined && loaded.name !== project) continue;
    for (const { event } of loaded.runs) {
      for (const entry of event.evidence ?? []) {
        if (!isCheckedEvidence(entry, loaded.path) || hashes.has(entry.ref)) continue;
        hashes.set(entry.ref, await hashFile(join(workspace.root, entry.ref)));
      }
    }
  }
  return hashes;
}

async function hashFile(file: string): Promise<string | null> {
  try {
    if (!(await lstat(file)).isFile()) return NOT_A_FILE;
    const hash = createHash("sha256");
    await pipeline(createReadStream(file), hash);
    return hash.digest("hex");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}
