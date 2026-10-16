import { parse, YAMLParseError } from "yaml";
import type { z } from "zod";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import { CommonFile, Config, RunEvent, TestCaseFile } from "../schema/index.js";
import { splitFrontmatter } from "./frontmatter.js";

// Pure parsers: file text in, typed value or located errors out (CONVENTIONS #4, #7).

/** A case file as stored: validated frontmatter plus its Markdown body. */
export type LoadedCase = { path: string; file: TestCaseFile; body: string };

/** YAML 1.2, core schema: no timestamp tag, so dates stay strings (ADR frontmatter-without-gray-matter). */
export function parseYaml(path: string, text: string, lineOffset = 1): Result<unknown> {
  const invalid = (message: string, line?: number): CasefileError => ({
    code: "yaml.invalid",
    path,
    message: message.split("\n")[0] ?? message,
    ...(line === undefined ? {} : { line: line + lineOffset - 1 }),
  });
  try {
    return ok(parse(text, { schema: "core" }));
  } catch (error) {
    if (error instanceof YAMLParseError)
      return fail(invalid(error.message, error.linePos?.[0].line));
    // Building the value throws plain errors too, e.g. for an alias with no anchor.
    if (error instanceof Error) return fail(invalid(error.message));
    throw error;
  }
}

export function validate<S extends z.ZodType>(
  schema: S,
  path: string,
  value: unknown,
  line?: number,
): Result<z.infer<S>> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return fail(
    ...parsed.error.issues.map(
      (issue): CasefileError => ({
        code: "schema.invalid",
        path,
        message: issue.message,
        ...(line === undefined ? {} : { line }),
        ...(issue.path.length === 0 ? {} : { field: issue.path.join(".") }),
      }),
    ),
  );
}

function parseYamlFile<S extends z.ZodType>(schema: S, path: string, text: string) {
  const yaml = parseYaml(path, text);
  return yaml.ok ? validate(schema, path, yaml.value) : yaml;
}

export function parseCaseFile(path: string, text: string): Result<LoadedCase> {
  const split = splitFrontmatter(path, text);
  if (!split.ok) return split;
  const { frontmatter, body, frontmatterLine } = split.value;
  const yaml = parseYaml(path, frontmatter, frontmatterLine);
  if (!yaml.ok) return yaml;
  const file = validate(TestCaseFile, path, yaml.value);
  return file.ok ? ok({ path, file: file.value, body }) : file;
}

export function parseCommonFile(path: string, text: string): Result<CommonFile> {
  return parseYamlFile(CommonFile, path, text);
}

export function parseConfigFile(path: string, text: string): Result<Config> {
  return parseYamlFile(Config, path, text);
}

/** Valid events of a run file plus one error per bad line. */
export type ParsedRunFile = { events: RunEvent[]; errors: CasefileError[] };

/**
 * `.runs/<run-id>.jsonl`: one event per non-blank line. A bad line does not hide
 * the valid ones: the file is append-only, so earlier events stay usable.
 */
export function parseRunFile(path: string, text: string): ParsedRunFile {
  const parsed: ParsedRunFile = { events: [], errors: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === "") return;
    const line = i + 1;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      parsed.errors.push({ code: "json.invalid", path, line, message: (error as Error).message });
      return;
    }
    const event = validate(RunEvent, path, value, line);
    if (event.ok) parsed.events.push(event.value);
    else parsed.errors.push(...event.errors);
  });
  return parsed;
}
