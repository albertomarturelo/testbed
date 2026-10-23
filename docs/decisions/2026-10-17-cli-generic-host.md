# The CLI renders the registry with fixed, generic rules

## Status

Accepted — 2026-10-17 (#11); output rules extended by #45; host inputs
`identity` and `via` added by #84. Amends the `project add <name> <path>` form of
[agent-driven-setup](2026-10-15-agent-driven-setup.md) and the interactive
skill prompt of `init`'s SPEC.

## Context

ADR [extension-model](2026-10-15-extension-model.md) makes the CLI a generic host:
every command comes from the operation registry, an extension's operation
appears without CLI changes, and [apps-vs-packages](2026-10-15-apps-vs-packages.md)
forbids operation logic in apps. The registry only holds `name`, a Zod `input`,
`output`, `actor`, `writes`, `spec` and `subject`, so the rules that turn that
into argv, output and exit codes must be the same for every operation. Some
inputs are not the user's to give (`init` needs the running casefile version and
the bundled skills), and the actor (human, agent, CI) is invisible to a process.

## Decision

1. **Command names:** an operation name's `-` separates words:
   `project-add` → `casefile project add`, `id-next` → `casefile id next`. The
   longest matching name wins. `spec`, `whoami`, `--help` and `--version` are host
   commands, not operations (`whoami`: ADR identity-override §5).
2. **Flags from the Zod input:** each top-level input field is a `--kebab-case`
   flag. Strings, numbers and enums take a value; booleans take none; arrays
   repeat the flag; any other shape takes JSON. The `subject` field (at most
   one, ADR [cli-repo-location](2026-10-15-cli-repo-location.md)) is the only
   positional. Parsing uses `node:util` `parseArgs`, strict.
   **Amendment:** `project add <name> <path>` becomes
   `project add <name> --path <path>`.
3. **Host inputs:** a field the host supplies declares it with Zod metadata,
   `.meta({ host: "version" | "skills" | "project" | "identity" | "via" })`, and
   is never a flag.
   `version` is the running casefile, `skills` the bundled skill files,
   `project` the `--project` value or the project containing `--cwd`
   (ADR [workspace-and-projects](2026-10-15-workspace-and-projects.md) §6),
   `identity` the email the host resolves: `CASEFILE_USER_EMAIL`, else the
   `git config user.email` Git resolves in the workspace (ADR
   [identity-override](2026-10-23-identity-override.md); left unset when there is none; an operation that needs it fails with
   `identity.missing`), and `via` where the call came from, `cli:<operation>`
   (the viewer: `ui:<operation>`). Every host fills the ones an operation it
   invokes declares
   (ADR [human-writes-through-operations](2026-10-19-human-writes-through-operations.md)).
   *(`identity` and `via` added by #84.)*
4. **Root:** the host finds the workspace from `--cwd` and invokes there; an
   operation with `root: "cwd"` (only `init`) also works without one: it runs
   at the workspace found above `--cwd`, else in `--cwd` itself, so a second
   `init` in a subdirectory never nests a workspace. No workspace for any other
   operation → `workspace.missing`, exit 2.
5. **Actor:** `human` unless `CASEFILE_ACTOR` is `agent` or `ci`; skills and CI
   set it. The registry enforces `actor` as before.
6. **Output:** `--json` prints the `Result` (`{ ok, value }` / `{ ok, errors }`)
   on stdout, always. Otherwise a value prints as indented `key: value` lines on
   stdout and errors as one diagnostic line each (`severity code path:line
   message`, then `hint`) on stderr, followed by error/warning counts when they
   are validator findings (they carry `severity`). An output
   field `next: string[]` is the operation's advice to the human and prints last.
   A list of flat records (scalars only) prints as a table with a header row.
   An error with `column` and a `field` naming a one-line text input prints that
   input with a `^` under the column (`query` DSL errors). Multi-line text
   prints as `key: |` with its lines indented under it, never in a table cell.
   *(Tables and caret added by #45; multi-line text by #68.)*
7. **Exit codes:** 0 `ok`; 1 errors (usage errors included); 2 when an error is
   `workspace.missing`. `validate` returns `ok` with warnings only and fails with
   every finding when one is an error, so ADR agent-driven-setup's 0 / 1 / 2 hold.
8. **SPECs:** `casefile spec <name>` prints the SPEC of a registered operation
   (resolved against its package: core or `.casefile/node_modules/<ext>`) or a
   core topic in `packages/core/specs/`. `--help` shows the SPEC's first
   paragraph, so operations need no separate description.

## Alternatives Considered

- **Per-operation CLI adapters** (hand-written commands calling core) — the most
  readable output, but every new operation, and every extension's, needs CLI
  code; exactly what extension-model rules out.
- **A CLI framework (commander, yargs, clipanion)** — help and parsing for free,
  but a runtime dependency (CONVENTIONS 10) for what `parseArgs` and a page of
  rules do, and their command trees are declared in code, not derived.
- **Host inputs as a hard-coded list per operation name** (`init` gets the
  version) — small today, but it is operation knowledge inside an app.
- **Actor flag (`--as agent`)** — visible in every command line an agent copies;
  an environment variable is set once by the skill or the CI job.
- **Interactive prompts** (`init` asking for skill targets) — a generic host
  cannot know when to ask; flags plus `next` advice work for humans and agents.

## Consequences

- `Operation` gains `root?: "cwd"`; core exposes the input-field introspection
  and the SPEC lookup so the MCP host reuses them.
- Read-only operations (`validate`, then `resolve`, `query`, `id next`) are core
  operations with `writes: []`; they read the workspace through core's loaders.
- An input field named like a global option (`cwd`, `project`, `json`, `help`,
  `version`) cannot be rendered unless it is a host input; the CLI rejects it,
  naming the clash, when the command is invoked.
- `--project` is a global flag: operations without a `project` host input
  ignore it.
- Output formatting is generic and plain; nicer output for one operation means
  a better-shaped output, not CLI code.
