import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { matchesGlob } from "./glob.js";
import type { Actor, OperationContext } from "./operation.js";

/**
 * Thrown by a guarded access. The context also records it, so `invoke` fails even
 * when the operation catches the throw and carries on.
 */
export class PathRefused extends Error {
  constructor(
    readonly code: "path.outside_workspace" | "write.not_allowed",
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "PathRefused";
  }
}

/**
 * Filesystem adapter for one invocation. Paths are checked lexically: they must
 * stay inside the workspace and, for writes, match one of `writes`.
 *
 * It guards well-behaved code; it is not a sandbox (ADR extension-model): an
 * operation that imports `node:fs` itself is not stopped. Invocations are not
 * transactional either — files written before a refusal stay on disk; hosts run
 * inside Git, where the change can be discarded.
 */
export function createContext(
  root: string,
  actor: Actor,
  writes: readonly string[],
): { context: OperationContext; refusals: PathRefused[] } {
  const refusals: PathRefused[] = [];
  const refuse = (error: PathRefused): never => {
    refusals.push(error);
    throw error;
  };
  const inside = (path: string): string => {
    const normalized = posix.normalize(path).replace(/\/+$/, "");
    if (
      posix.isAbsolute(path) ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      refuse(
        new PathRefused("path.outside_workspace", path, `${path} is not inside the workspace`),
      );
    }
    return normalized;
  };
  const guard = (path: string, isDirectory: boolean): string => {
    const normalized = inside(path);
    // A directory may be created when something below it could be written.
    const probe = isDirectory ? `${normalized}/_` : normalized;
    if (!writes.some((pattern) => matchesGlob(probe, pattern))) {
      refuse(
        new PathRefused(
          "write.not_allowed",
          normalized,
          `${normalized} is outside this operation's writes`,
        ),
      );
    }
    return normalized;
  };

  const context: OperationContext = {
    root,
    actor,
    async readText(path) {
      const target = join(root, inside(path));
      try {
        return await readFile(target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async exists(path) {
      const target = join(root, inside(path));
      try {
        await stat(target);
        return true;
      } catch {
        return false;
      }
    },
    async writeText(path, text) {
      const target = join(root, guard(path, false));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    },
    async mkdir(path) {
      await mkdir(join(root, guard(path, true)), { recursive: true });
    },
  };
  return { context, refusals };
}
