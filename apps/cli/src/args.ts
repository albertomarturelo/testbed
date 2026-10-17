import { type ParseArgsConfig, parseArgs } from "node:util";
import {
  type CasefileError,
  fail,
  type InputField,
  inputFields,
  type Operation,
  ok,
  type Result,
} from "@casefile/core";

/** Options every command takes (ADR cli-repo-location, cli-generic-host). */
export const GLOBAL_OPTIONS = {
  cwd: { type: "string" },
  project: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const satisfies NonNullable<ParseArgsConfig["options"]>;

export type GlobalValues = {
  cwd?: string;
  project?: string;
  json?: boolean;
  help?: boolean;
  version?: boolean;
};

/** An operation as a command: its words and the fields the user gives as flags. */
export type Command = {
  operation: Operation;
  words: string[];
  /** Input fields rendered as flags: neither host inputs nor the subject. */
  flags: InputField[];
  subject: InputField | undefined;
  hosts: InputField[];
};

export function toCommand(operation: Operation): Result<Command> {
  const fields = inputFields(operation);
  const hosts = fields.filter((f) => f.host !== undefined);
  const subject = fields.find((f) => f.host === undefined && f.name === operation.subject);
  const flags = fields.filter((f) => f.host === undefined && f !== subject);
  const clashes = flags.filter((f) => kebab(f.name) in GLOBAL_OPTIONS);
  if (clashes.length > 0) {
    return fail(
      ...clashes.map(
        (f): CasefileError => ({
          code: "cli.flag_conflict",
          field: f.name,
          message: `'${operation.name}' input '${f.name}' clashes with the global --${kebab(f.name)}`,
        }),
      ),
    );
  }
  return ok({ operation, words: operation.name.split("-"), flags, subject, hosts });
}

/** The command whose words start `argv` (longest name wins), and the arguments after them. */
export function matchCommand(
  commands: readonly Command[],
  argv: readonly string[],
): { command: Command; rest: string[] } | null {
  let best: Command | null = null;
  for (const command of commands) {
    const matches = command.words.every((word, i) => argv[i] === word);
    if (matches && (best === null || command.words.length > best.words.length)) best = command;
  }
  return best === null ? null : { command: best, rest: argv.slice(best.words.length) };
}

export type ParsedArgs = {
  globals: GlobalValues;
  /** The user's part of the input; host inputs are added by the caller. */
  input: Record<string, unknown>;
};

/** Parses the arguments after the command words; any problem is a `cli.usage` error. */
export function parseCommandArgs(command: Command, args: readonly string[]): Result<ParsedArgs> {
  const options: NonNullable<ParseArgsConfig["options"]> = { ...GLOBAL_OPTIONS };
  for (const field of command.flags) {
    options[kebab(field.name)] = {
      type: field.kind === "boolean" ? "boolean" : "string",
      multiple: field.multiple,
    };
  }
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args: [...args], options, strict: true, allowPositionals: true });
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const max = command.subject === undefined ? 0 : 1;
  if (positionals.length > max) {
    const extra = positionals.slice(max).join(" ");
    return usage(`unexpected argument '${extra}'; only the subject is positional`);
  }

  const input: Record<string, unknown> = {};
  if (command.subject !== undefined && positionals[0] !== undefined) {
    const value = convert(command.subject, positionals[0]);
    if (!value.ok) return value;
    input[command.subject.name] = value.value;
  }
  for (const field of command.flags) {
    const raw = values[kebab(field.name)];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      const items: unknown[] = [];
      for (const item of raw) {
        const value = convert(field, String(item));
        if (!value.ok) return value;
        items.push(value.value);
      }
      input[field.name] = items;
    } else if (typeof raw === "boolean") {
      input[field.name] = raw;
    } else {
      const value = convert(field, String(raw));
      if (!value.ok) return value;
      input[field.name] = value.value;
    }
  }
  const globals: GlobalValues = {};
  for (const key of Object.keys(GLOBAL_OPTIONS) as (keyof GlobalValues)[]) {
    if (values[key] !== undefined) (globals as Record<string, unknown>)[key] = values[key];
  }
  return ok({ globals, input });
}

/** Positionals of a host command that takes only the global options (`spec`). */
export function parseGlobalArgs(args: readonly string[]): Result<string[]> {
  try {
    const { positionals } = parseArgs({
      args: [...args],
      options: GLOBAL_OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    return ok(positionals);
  } catch (error) {
    return usage(error instanceof Error ? error.message : String(error));
  }
}

/** The value of `--cwd`, found before the command is known (it decides which commands exist). */
export function findCwd(argv: readonly string[]): string | undefined {
  for (const [i, arg] of argv.entries()) {
    if (arg === "--") return undefined;
    if (arg === "--cwd") return argv[i + 1];
    if (arg.startsWith("--cwd=")) return arg.slice("--cwd=".length);
  }
  return undefined;
}

/** `skillsInto` → `skills-into`. */
export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function convert(field: InputField, raw: string): Result<unknown> {
  if (field.kind === "number") {
    // Zod reports a non-number with the field name.
    return ok(raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw);
  }
  if (field.kind === "json") {
    try {
      return ok(JSON.parse(raw));
    } catch {
      return usage(`--${kebab(field.name)} takes JSON`);
    }
  }
  return ok(raw);
}

function usage<T>(message: string): Result<T> {
  return fail({ code: "cli.usage", message });
}
