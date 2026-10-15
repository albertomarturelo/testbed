/**
 * An error as a value with a location (CONVENTIONS #7). `code` is stable; hosts
 * map it to exit codes and messages.
 */
export type CasefileError = {
  code: string;
  /** Repo-relative path (POSIX separators) of the file the error is about. */
  path: string;
  message: string;
  /** 1-based line in the file, when known. */
  line?: number;
  /** Dotted field path inside the file, when known (`automation.eligible`, `steps.0.do`). */
  field?: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; errors: CasefileError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(...errors: CasefileError[]): Result<T> {
  return { ok: false, errors };
}
