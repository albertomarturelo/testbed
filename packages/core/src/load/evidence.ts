import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { isCheckedEvidence, NOT_A_FILE } from "../operations/evidence.js";
import type { Evidence } from "../schema/index.js";
import type { LoadedWorkspace } from "./workspace.js";

/**
 * The stored evidence entry a run event names under `ref` (ADR run-evidence-files
 * §7): a file `run` stored (`image`, `video`, `file`) inside a `.runs/<run-id>/`
 * directory of the event's own project. `null` when no event does: the viewer
 * serves only what a run event names. Pure: reads nothing.
 */
export function namedStoredEvidence(workspace: LoadedWorkspace, ref: string): Evidence | null {
  for (const loaded of workspace.projects) {
    for (const { event } of loaded.runs) {
      for (const entry of event.evidence ?? []) {
        if (entry.ref === ref && isCheckedEvidence(entry, loaded.path)) return entry;
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
