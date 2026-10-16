import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { matchesGlob } from "./glob.js";
import type { Actor, OperationContext } from "./operation.js";

/**
 * Thrown by a guarded access; `invoke` turns it into an error value with `code`:
 * `path.outside_workspace` or `write.not_allowed`.
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
 */
export function createContext(
  root: string,
  actor: Actor,
  writes: readonly string[],
): OperationContext {
  const inside = (path: string): string => {
    const normalized = posix.normalize(path).replace(/\/+$/, "");
    if (
      posix.isAbsolute(path) ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new PathRefused("path.outside_workspace", path, `${path} is not inside the workspace`);
    }
    return normalized;
  };
  const guard = (path: string, isDirectory: boolean): string => {
    const normalized = inside(path);
    // A directory may be created when something below it could be written.
    const probe = isDirectory ? `${normalized}/_` : normalized;
    if (!writes.some((pattern) => matchesGlob(probe, pattern))) {
      throw new PathRefused(
        "write.not_allowed",
        normalized,
        `${normalized} is outside this operation's writes`,
      );
    }
    return normalized;
  };

  return {
    root,
    actor,
    async readText(path) {
      try {
        return await readFile(join(root, inside(path)), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async exists(path) {
      try {
        await stat(join(root, inside(path)));
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
}
