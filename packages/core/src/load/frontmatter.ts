import { fail, ok, type Result } from "../errors.js";

export type SplitFile = {
  /** YAML text between the `---` lines. */
  frontmatter: string;
  /** Markdown after the closing `---`, line endings normalized to `\n`. */
  body: string;
  /** 1-based line where the frontmatter text starts, to offset YAML error lines. */
  frontmatterLine: number;
};

const DELIMITER = "---";

/**
 * Splits a case file into frontmatter and body (ADR frontmatter-without-gray-matter):
 * the first line is `---`, the block ends at the next line that is exactly `---`.
 */
export function splitFrontmatter(path: string, text: string): Result<SplitFile> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0] !== DELIMITER) {
    return fail({
      code: "frontmatter.missing",
      path,
      line: 1,
      message: "file must start with a `---` line",
    });
  }
  const end = lines.indexOf(DELIMITER, 1);
  if (end === -1) {
    return fail({
      code: "frontmatter.unclosed",
      path,
      line: 1,
      message: "frontmatter has no closing `---` line",
    });
  }
  return ok({
    frontmatter: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
    frontmatterLine: 2,
  });
}
