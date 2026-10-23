import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Actor,
  type CasefileError,
  fail,
  findWorkspaceRoot,
  gitUserEmail,
  type HostInput,
  type HostRegistry,
  type Identity,
  ok,
  openRegistry,
  projectAt,
  type Result,
  readSkillBundle,
  readSpec,
  resolveIdentity,
  specSummary,
} from "@casefile/core";
import {
  type Command,
  findCwd,
  kebab,
  matchCommand,
  parseCommandArgs,
  parseGlobalArgs,
  toCommand,
} from "./args.js";
import { planDelegation, type Reexec, reexec } from "./delegate.js";
import { renderErrors, renderValue } from "./render.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * Skills `init` offers (ADR agent-driven-setup): bundled into the package as
 * `skills/` when it is packed. Only when this CLI runs from its own monorepo
 * (`<root>/apps/cli`, with `pnpm-workspace.yaml` at the root) does it fall back
 * to the repository's `skills/`; an installed copy never reads a directory
 * outside its package.
 */
const SKILLS_DIR = skillsDir(fileURLToPath(new URL("../", import.meta.url)));

export function skillsDir(packageDir: string): string {
  const packed = join(packageDir, "skills");
  const root = resolve(packageDir, "../..");
  const inMonorepo =
    resolve(packageDir) === join(root, "apps", "cli") &&
    existsSync(join(root, "pnpm-workspace.yaml"));
  return !existsSync(packed) && inMonorepo ? join(root, "skills") : packed;
}

const ACTORS: readonly Actor[] = ["human", "agent", "ci"];

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CliEnvironment = {
  /** Directory `--cwd` is resolved against. */
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  /** How to re-execute the pinned casefile; tests replace it. Default: `reexec`. */
  reexec?: Reexec;
};

/**
 * The generic host (ADR cli-generic-host): every command is a registry
 * operation, rendered and run with the same rules. Never throws for user input.
 */
export async function run(
  argv: readonly string[],
  environment: CliEnvironment,
): Promise<CliResult> {
  // The pinned casefile runs, whatever binary was invoked (ADR casefile-toolchain-dir §4).
  const plan = await planDelegation(argv, environment.cwd, environment.env, pkg.version);
  // Saying which casefile runs, and how to use it, works even before the install.
  const local = argv[0] === undefined || ["-h", "--help", "-v", "--version"].includes(argv[0]);
  if (plan.kind === "fail" && !local) return result(fail(...plan.errors), argv.includes("--json"));
  if (plan.kind === "delegate") {
    return { code: (environment.reexec ?? reexec)(plan, argv), stdout: "", stderr: "" };
  }

  const cwd = resolve(environment.cwd, findCwd(argv) ?? ".");
  const located = await findWorkspaceRoot(cwd);
  const root = located.ok ? located.value : null;
  const host = await openRegistry(root);
  const commands: Command[] = [];
  /** Operations the CLI cannot render (ADR cli-generic-host): reported, never hidden. */
  const rejected: { words: string[]; errors: CasefileError[] }[] = [];
  for (const operation of host.registry.list()) {
    const command = toCommand(operation);
    if (command.ok) commands.push(command.value);
    else rejected.push({ words: operation.name.split("-"), errors: command.errors });
  }

  const [first] = argv;
  if (first === undefined || first === "-h" || first === "--help") {
    return out(await usage(commands, host));
  }
  if (first === "-v" || first === "--version") return out(pkg.version);
  if (first === "spec") return spec(argv.slice(1), host);
  if (first === "whoami") return whoami(argv.slice(1), root ?? cwd, environment.env);

  if (first.startsWith("-")) {
    return result(
      fail({
        code: "cli.usage",
        message: `the command comes first: casefile <command> [subject] [flags], not '${first}'`,
      }),
      argv.includes("--json"),
    );
  }
  const matched = matchCommand(commands, argv);
  const blocked = rejected.find(
    ({ words }) =>
      words.every((word, i) => argv[i] === word) &&
      words.length > (matched?.command.words.length ?? 0),
  );
  if (blocked !== undefined) return result(fail(...blocked.errors), argv.includes("--json"));
  if (matched === null) {
    const notes = [...host.errors, ...rejected.flatMap((r) => r.errors)].map(
      (e) => `note: ${e.message}`,
    );
    return {
      code: 1,
      stdout: "",
      stderr: [
        `casefile: unknown command '${first}'`,
        ...notes,
        "",
        await usage(commands, host),
      ].join("\n"),
    };
  }
  const { command, rest } = matched;
  const parsed = parseCommandArgs(command, rest);
  const json = rest.includes("--json");
  if (!parsed.ok) return result(parsed, json);
  const { globals, input } = parsed.value;
  if (globals.help) return out(await commandHelp(command, host));

  const actor = environment.env.CASEFILE_ACTOR ?? "human";
  if (!ACTORS.includes(actor as Actor)) {
    return result(
      fail({
        code: "cli.usage",
        message: `CASEFILE_ACTOR must be one of ${ACTORS.join(", ")}, not '${actor}'`,
      }),
      json,
    );
  }
  // `root: "cwd"` (init) runs at an existing workspace rather than nesting one.
  const invokeRoot = root ?? (command.operation.root === "cwd" ? cwd : null);
  if (invokeRoot === null) return result(located as Result<never>, json);

  for (const field of command.hosts) {
    const value = await hostValue(field.host as HostInput, {
      root,
      cwd,
      host,
      project: globals.project,
      operation: command.operation.name,
      env: environment.env,
    });
    if (!value.ok) return result(value, json, input);
    if (value.value !== undefined) input[field.name] = value.value;
  }
  const outcome = await host.registry.invoke(command.operation.name, input, {
    root: invokeRoot,
    actor: actor as Actor,
  });
  return result(outcome, json, input);
}

async function hostValue(
  name: HostInput,
  at: {
    root: string | null;
    cwd: string;
    host: HostRegistry;
    project: string | undefined;
    operation: string;
    env: CliEnvironment["env"];
  },
): Promise<Result<unknown>> {
  switch (name) {
    case "version":
      return ok(pkg.version);
    case "skills":
      return ok(await readSkillBundle(SKILLS_DIR));
    case "project": {
      if (at.project !== undefined) return ok(at.project);
      const projects = at.host.config?.projects ?? [];
      return ok(at.root === null ? undefined : (projectAt(projects, at.root, at.cwd) ?? undefined));
    }
    case "identity": {
      // Unset: the operation that needs it says `identity.missing`.
      const identity = await hostIdentity(at.root ?? at.cwd, at.env);
      return identity.ok ? ok(identity.value?.email) : identity;
    }
    case "via":
      return ok(`cli:${at.operation}`);
  }
}

/**
 * Who the person is (ADR identity-override): `CASEFILE_USER_EMAIL` (+ `_NAME`),
 * else `git config user.email` in `dir`. The host reads them; core decides.
 */
async function hostIdentity(
  dir: string,
  env: CliEnvironment["env"],
): Promise<Result<Identity | null>> {
  return resolveIdentity({
    env: { email: env.CASEFILE_USER_EMAIL, name: env.CASEFILE_USER_NAME },
    git: { email: await gitUserEmail(dir, env) },
  });
}

/** `casefile whoami`: the identity writes are made as, and where it came from. */
async function whoami(
  args: readonly string[],
  dir: string,
  env: CliEnvironment["env"],
): Promise<CliResult> {
  const json = args.includes("--json");
  const parsed = parseGlobalArgs(args);
  if (!parsed.ok) return result(parsed, json);
  if (parsed.value.length > 0) {
    return result(fail({ code: "cli.usage", message: "usage: casefile whoami [--json]" }), json);
  }
  const identity = await hostIdentity(dir, env);
  if (!identity.ok) return result(identity, json);
  if (identity.value === null) {
    return result(
      fail({
        code: "identity.missing",
        field: "identity",
        message:
          "no identity: set CASEFILE_USER_EMAIL, or `git config user.email` in the workspace",
      }),
      json,
    );
  }
  const { email, name, source } = identity.value;
  const from = source === "env" ? "CASEFILE_USER_EMAIL" : "git config user.email";
  return result(ok({ email, ...(name === undefined ? {} : { name }), source, from }), json);
}

/** `casefile spec <name>`: words join with `-`, so `spec project add` works too. */
async function spec(args: readonly string[], host: HostRegistry): Promise<CliResult> {
  const json = args.includes("--json");
  const parsed = parseGlobalArgs(args);
  if (!parsed.ok) return result(parsed, json);
  if (parsed.value.length === 0) {
    return result(fail({ code: "cli.usage", message: "usage: casefile spec <name>" }), json);
  }
  const text = await readSpec(host.specs, parsed.value.join("-"));
  return text.ok ? out(text.value.trimEnd()) : result(text, json);
}

function result(
  outcome: Result<unknown>,
  json: boolean,
  input: Readonly<Record<string, unknown>> = {},
): CliResult {
  const code = outcome.ok ? 0 : exitCode(outcome.errors);
  if (json) return { code, stdout: JSON.stringify(outcome, null, 2), stderr: "" };
  return outcome.ok
    ? { code, stdout: renderValue(outcome.value), stderr: "" }
    : { code, stdout: "", stderr: renderErrors(outcome.errors, input) };
}

/** ADR agent-driven-setup: 0 ok, 1 errors, 2 no workspace. */
function exitCode(errors: readonly CasefileError[]): number {
  return errors.some((e) => e.code === "workspace.missing") ? 2 : 1;
}

function out(stdout: string): CliResult {
  return { code: 0, stdout, stderr: "" };
}

async function summary(command: Command, host: HostRegistry): Promise<string> {
  const text = await readSpec(host.specs, command.operation.name);
  return text.ok ? specSummary(text.value) : "";
}

async function usage(commands: readonly Command[], host: HostRegistry): Promise<string> {
  const rows: [string, string][] = [];
  for (const command of commands) {
    rows.push([command.words.join(" "), firstSentence(await summary(command, host))]);
  }
  rows.push(["spec <name>", "Prints the SPEC of an operation or topic."]);
  rows.push(["whoami", "Shows who writes are made as, and where that comes from."]);
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  return `casefile ${pkg.version} (preview)

Usage: casefile <command> [subject] [flags]

Commands:
${rows.map(([name, text]) => `  ${name.padEnd(width)}${text}`).join("\n")}

Global flags:
  --cwd <dir>       Where to look for the workspace (casefile.yaml, searched upwards)
  --project <name>  The project to act on (default: the one containing --cwd)
  --json            Print the result as JSON
  -h, --help        Show help (casefile <command> --help for one command)
  -v, --version     Show the version

Set CASEFILE_ACTOR=agent or ci when an agent or CI runs casefile (default: human).
Set CASEFILE_USER_EMAIL (and CASEFILE_USER_NAME) to write as someone other than
\`git config user.email\`; \`casefile whoami\` shows who that is.`;
}

async function commandHelp(command: Command, host: HostRegistry): Promise<string> {
  const subject = command.subject === undefined ? "" : ` <${command.subject.name}>`;
  const flags = command.flags.map((field) => {
    const value =
      field.kind === "boolean" ? "" : field.choices ? ` <${field.choices.join("|")}>` : " <value>";
    const notes = [
      field.required ? "required" : "",
      field.multiple ? "repeatable" : "",
      field.kind === "json" ? "JSON" : "",
    ].filter(Boolean);
    return `  --${kebab(field.name)}${value}${notes.length > 0 ? `  (${notes.join(", ")})` : ""}`;
  });
  return [
    `Usage: casefile ${command.words.join(" ")}${subject} [flags]`,
    "",
    await summary(command, host),
    "",
    `Actor: ${command.operation.actor.join(", ")}`,
    ...(flags.length > 0 ? ["", "Flags:", ...flags] : []),
    "",
    `Full SPEC: casefile spec ${command.operation.name}`,
  ].join("\n");
}

function firstSentence(text: string): string {
  const end = text.search(/\.(\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}
