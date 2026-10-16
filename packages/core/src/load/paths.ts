import { posix } from "node:path";

/** `casefile.yaml` marks the workspace root (ADR workspace-and-projects). */
export const CONFIG_FILE = "casefile.yaml";

/** Where a project keeps its cases, relative to the project directory. */
export const TESTS_DIR = "context/tests";

/**
 * Canonical form of a project path from `casefile.yaml`: POSIX-normalized, no
 * trailing `/`, `.` for the workspace root. `apps/web/` and `./apps//web` both
 * become `apps/web`.
 */
export function normalizeProjectPath(path: string): string {
  const normalized = posix.normalize(path);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}
