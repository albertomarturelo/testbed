/**
 * An error as a value with a location (CONVENTIONS #7). `code` is stable; hosts
 * map it to exit codes and messages.
 */
export type CasefileError = {
  code: string;
  /**
   * Workspace-relative path (POSIX separators) of the file the error is about;
   * absent when it is about no file (e.g. an operation's input). Exception:
   * `workspace.missing` has no workspace, so it carries the directory the caller
   * searched from, as given.
   */
  path?: string;
  /** Dotted field path inside the file or input, when known (`automation.eligible`, `steps.0.do`). */
  field?: string;
  message: string;
  /** 1-based line in the file, when known. */
  line?: number;
};

export type Result<T> = { ok: true; value: T } | { ok: false; errors: CasefileError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(...errors: CasefileError[]): Result<T> {
  return { ok: false, errors };
}
