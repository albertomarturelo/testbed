import { parse, YAMLParseError } from "yaml";
import type { z } from "zod";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import {
  CommonFile,
  Config,
  PropertiesFile,
  ReleasePolicy,
  RunEvent,
  TestCaseFile,
} from "../schema/index.js";
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

/** The pending marker the scaffold leaves in fields that need a decision. */
const TODO_MARKER = "TODO";

/**
 * `validate` for YAML files (ADR agent-driven-setup, point 4): each scalar exactly
 * equal to `TODO` is reported as `scaffold.todo` instead of the schema errors on
 * or under its field. A file with a marker never loads, so no undecided value
 * slips in, even where `TODO` would pass the schema (a `title`).
 */
function validateYaml<S extends z.ZodType>(
  schema: S,
  path: string,
  value: unknown,
): Result<z.infer<S>> {
  const result = validate(schema, path, value);
  const markers = todoMarkers(value, []);
  if (markers.length === 0) return result;
  const pending = (field: string | undefined) =>
    field !== undefined && markers.some((m) => field === m || field.startsWith(`${m}.`));
  return fail(
    ...markers.map(
      (field): CasefileError => ({
        code: "scaffold.todo",
        path,
        message: `\`${field || "(file)"}\` is still ${TODO_MARKER}: replace it with a decision`,
        ...(field === "" ? {} : { field }),
      }),
    ),
    ...(result.ok ? [] : result.errors.filter((e) => !pending(e.field))),
  );
}

/** Dotted fields holding the marker, in file order; `""` when the whole file is one. */
function todoMarkers(value: unknown, at: readonly string[]): string[] {
  if (value === TODO_MARKER) return [at.join(".")];
  if (Array.isArray(value)) return value.flatMap((v, i) => todoMarkers(v, [...at, String(i)]));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, v]) => todoMarkers(v, [...at, key]));
  }
  return [];
}

function parseYamlFile<S extends z.ZodType>(schema: S, path: string, text: string) {
  const yaml = parseYaml(path, text);
  return yaml.ok ? validateYaml(schema, path, yaml.value) : yaml;
}

export function parseCaseFile(path: string, text: string): Result<LoadedCase> {
  const split = splitFrontmatter(path, text);
  if (!split.ok) return split;
  const { frontmatter, body, frontmatterLine } = split.value;
  const yaml = parseYaml(path, frontmatter, frontmatterLine);
  if (!yaml.ok) return yaml;
  const file = validateYaml(TestCaseFile, path, yaml.value);
  return file.ok ? ok({ path, file: file.value, body }) : file;
}

export function parseCommonFile(path: string, text: string): Result<CommonFile> {
  return parseYamlFile(CommonFile, path, text);
}

export function parseConfigFile(path: string, text: string): Result<Config> {
  return parseYamlFile(Config, path, text);
}

export function parsePropertiesFile(path: string, text: string): Result<PropertiesFile> {
  return parseYamlFile(PropertiesFile, path, text);
}

export function parsePolicyFile(path: string, text: string): Result<ReleasePolicy> {
  return parseYamlFile(ReleasePolicy, path, text);
}

/** A run event and where it is stored, so findings can point at its line. */
export type LoadedRun = { path: string; line: number; event: RunEvent };

/** Valid events of a run file plus one error per bad line. */
export type ParsedRunFile = { runs: LoadedRun[]; errors: CasefileError[] };

/**
 * `.runs/<run-id>.jsonl`: one event per non-blank line. A bad line does not hide
 * the valid ones: the file is append-only, so earlier events stay usable.
 */
export function parseRunFile(path: string, text: string): ParsedRunFile {
  const parsed: ParsedRunFile = { runs: [], errors: [] };
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
    if (event.ok) parsed.runs.push({ path, line, event: event.value });
    else parsed.errors.push(...event.errors);
  });
  return parsed;
}
