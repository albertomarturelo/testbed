import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isCheckedEvidence, sha256Hex } from "../operations/evidence.js";
import type { LoadedWorkspace } from "./workspace.js";

/**
 * Filesystem adapter for `validate`: the SHA-256 of every stored evidence file
 * a run event names (ADR run-evidence-files §9), keyed by its workspace-relative
 * `ref`; `null` when the file is not there.
 */
export async function hashStoredEvidence(
  workspace: LoadedWorkspace,
): Promise<Map<string, string | null>> {
  const hashes = new Map<string, string | null>();
  for (const project of workspace.projects) {
    for (const { event } of project.runs) {
      for (const entry of event.evidence ?? []) {
        if (!isCheckedEvidence(entry, project.path) || hashes.has(entry.ref)) continue;
        hashes.set(entry.ref, await hashFile(join(workspace.root, entry.ref)));
      }
    }
  }
  return hashes;
}

async function hashFile(file: string): Promise<string | null> {
  try {
    return sha256Hex(await readFile(file));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return null;
    throw error;
  }
}
