import type { z } from "zod";
import type { Result } from "../errors.js";

/** Who invokes an operation (ADR write-ownership): the CLI alone does not say. */
export type Actor = "human" | "agent" | "ci";

/**
 * What a running operation can do to the workspace. Paths are workspace-relative
 * and POSIX. Every write is checked against the operation's `writes`; a refused
 * write ends the invocation with `write.not_allowed`.
 */
export type OperationContext = {
  /** Absolute path of the workspace root. */
  root: string;
  actor: Actor;
  /** File contents, or `null` when the file does not exist. */
  readText(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  /** Writes a file, creating parent directories. */
  writeText(path: string, text: string): Promise<void>;
  /** Creates a directory (and parents); allowed when a file inside it could be written. */
  mkdir(path: string): Promise<void>;
};

/**
 * An operation, declared once and rendered by every host (ADR extension-model):
 * CLI command, MCP tool, inbox `kind`, web screen.
 */
export type Operation<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  /** Slug, unique in the registry: `cover`, `project-add`. */
  name: string;
  input: I;
  output: O;
  /** Actors allowed to invoke it. */
  actor: readonly Actor[];
  /** Workspace-relative globs it may write (`**`, `*`, `?`). */
  writes: readonly string[];
  /** SPEC path, relative to the declaring package (ADR specs-ship-with-operations). */
  spec: string;
  /** The input field that is the operation's subject, a CLI positional (ADR cli-repo-location). */
  subject?: string;
  /**
   * `cwd`: it also runs without a workspace, in the directory the host was
   * given (only `init`, which creates one); inside a workspace it still runs at
   * its root. Default: needs the workspace root (ADR cli-generic-host).
   */
  root?: "cwd";
  run(input: z.infer<I>, context: OperationContext): Promise<Result<z.infer<O>>>;
};

/** Declares an operation; the registry validates it on `register`. */
export function defineOperation<I extends z.ZodType, O extends z.ZodType>(
  operation: Operation<I, O>,
): Operation<I, O> {
  return Object.freeze({
    ...operation,
    actor: Object.freeze([...operation.actor]),
    writes: Object.freeze([...operation.writes]),
  });
}
