import type { CasefileError } from "@casefile/core";

/** An error value or a validator finding: anything with a `code` and a `message`. */
type Diagnostic = CasefileError & { severity?: string; hint?: string };

/** Output field printed last, as advice (ADR cli-generic-host). */
const NEXT = "next";

/** A successful operation's output as indented `key: value` lines, `next` last. */
export function renderValue(value: unknown): string {
  const lines: string[] = [];
  const next = isRecord(value) && Array.isArray(value[NEXT]) ? (value[NEXT] as unknown[]) : [];
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key !== NEXT) lines.push(...entry(key, item, ""));
    }
  } else {
    lines.push(scalar(value));
  }
  if (next.length > 0) lines.push("", "Next:", ...next.map((step) => `  - ${String(step)}`));
  return lines.join("\n");
}

/**
 * One line per error (`severity code path:line message`, then its hint); for
 * validator findings (they carry `severity`), the counts too.
 */
export function renderErrors(errors: readonly CasefileError[]): string {
  const lines = errors.flatMap((error) => diagnostic(error as Diagnostic));
  if (!errors.some((e) => (e as Diagnostic).severity !== undefined)) return lines.join("\n");
  const count = (severity: string) =>
    errors.filter((e) => ((e as Diagnostic).severity ?? "error") === severity).length;
  const errorCount = count("error");
  const warningCount = count("warning");
  lines.push(
    "",
    `${errorCount} ${errorCount === 1 ? "error" : "errors"}, ${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`,
  );
  return lines.join("\n");
}

function entry(key: string, value: unknown, indent: string): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${key}: (none)`];
    if (value.every(isDiagnostic)) {
      return [`${indent}${key}:`, ...value.flatMap((d) => diagnostic(d, `${indent}  `))];
    }
    return [
      `${indent}${key}:`,
      ...value.flatMap((item) =>
        isRecord(item)
          ? [
              `${indent}  -`,
              ...Object.entries(item).flatMap(([k, v]) => entry(k, v, `${indent}    `)),
            ]
          : [`${indent}  - ${scalar(item)}`],
      ),
    ];
  }
  if (isRecord(value)) {
    return [
      `${indent}${key}:`,
      ...Object.entries(value).flatMap(([k, v]) => entry(k, v, `${indent}  `)),
    ];
  }
  return [`${indent}${key}: ${scalar(value)}`];
}

function diagnostic(d: Diagnostic, indent = ""): string[] {
  const at = [d.path, d.line, d.column].filter((part) => part !== undefined).join(":");
  const where = [at, d.field === undefined ? "" : `[${d.field}]`].filter(Boolean).join(" ");
  const head = [d.severity ?? "error", d.code, where, d.message].filter(Boolean);
  return [`${indent}${head.join("  ")}`, ...(d.hint ? [`${indent}  hint: ${d.hint}`] : [])];
}

function scalar(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}
