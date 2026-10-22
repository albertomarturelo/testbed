# Architecture — casefile

> In progress: `packages/core` has schemas, loader, resolver, id generator, query DSL,
> gate evaluation, the operation/extension registry, the built-in operations `init`,
> `project-add`, `validate`, `resolve`, `query`, `id-next`, `overview`, `runs`, `cover` and
> `review` (the two that write cases, for the agent or the QA), and the
> validator (finding contract, code catalogue, level runner; levels workspace → file
> schemas → cross-file → resolution → environment, fed by `loadWorkspace` and
> `loadToolchain`); `apps/cli` renders the registry and `apps/web` is the read-only
> local UI (`pnpm ui`); the
> rest is the **target** architecture taken from the founding brief. Anything not stated in the brief is marked
> "(inferred — confirm)". Decisions are recorded in [decisions/](decisions/_index.md).

## Thesis

Test cases belong in the repository, next to the code they verify. Test-management
platforms (Zephyr, Xray, TestRail) are mirrors for persistence and reporting, not
where cases are born. casefile turns a repo into the QA knowledge base an AI agent
uses to propose, maintain, execute and report test cases, while a human QA
orchestrates from a local UI without touching files.

## Actors

| Actor | Writes | Through |
|---|---|---|
| Agent (Claude Code, Codex) | Files under `context/tests/` (sole writer); `projects` and `commons` in `casefile.yaml` | Skills with limited scope, MCP, `casefile project add` |
| Human QA | Cases through `review`/`cover`, results through `run` ([human-writes-through-operations](decisions/2026-10-19-human-writes-through-operations.md)); intents (`.inbox/`, deferred); `casefile.yaml` `version`/`extensions` | Local UI (`pnpm ui` in F1; `casefile ui` after the publishing decision — [local-ui-stack](decisions/2026-10-17-local-ui-stack.md)), `casefile init` |
| CI | Run results, validation verdicts | `casefile` CLI |
| Release manager | Sign-offs | Readiness reports, `release sign` |

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ apps (generic hosts):  cli  ·  mcp  ·  web (F1)              │
│   + skills/ (markdown, run by the user's agent)              │
├──────────────────────────────────────────────────────────────┤
│ extensions (built-in or npm): operations · ingesters ·       │
│   bridges · validators   — all registered through core's API │
├──────────────────────────────────────────────────────────────┤
│ core:  schema · loader · resolver · dsl · index · validator  │
│        ids · git · gates · operation registry (only writer)  │
├──────────────────────────────────────────────────────────────┤
│ Data:  files in the user's repo (the only source of truth)   │
└──────────────────────────────────────────────────────────────┘
```

Dependency direction: apps depend on `packages/*` only and never on each other;
they coordinate through files and Git. Operations are declared once in the
registry (`actor`, `writes`, `input`, `output`, `spec`, `run`) and every app
renders the registry: CLI commands, MCP tools, inbox `kind`s, web screens. See
[apps-vs-packages](decisions/2026-10-15-apps-vs-packages.md),
[extension-model](decisions/2026-10-15-extension-model.md) and
[write-ownership](decisions/2026-10-15-write-ownership.md).

## Module map (planned)

| Path | Responsibility | Phase |
|---|---|---|
| `packages/core` | Schemas (JSON Schema 2020-12 + Zod), file loader (`yaml` + frontmatter splitter in core), inheritance resolver, query DSL (parser + evaluator), in-memory index with watcher, validator, id generator, Git utilities, gate evaluation, operation/extension registry, built-in operations and ingesters | F0 |
| `apps/cli` | Generic host ([cli-generic-host](decisions/2026-10-17-cli-generic-host.md)): renders the registry as commands; `init`, `project add`, `validate --json`, `resolve`, `query`, `id next`, `overview`, `runs`, `cover`, `review`, `ingest junit`, `spec` working in F0 (`gates` next, #47); published to npm as `@casefile/cli` with the bin `casefile` ([npm-scope-casefile](decisions/2026-10-17-npm-scope-casefile.md)); `casefile mcp` still open | F0 |
| `apps/mcp` | Generic host: MCP server (stdio + Streamable HTTP), token scopes; `cases.search`, `coverage.query` real, the rest typed stubs | F0 skeleton / F2 full |
| `apps/web` | Local UI: Vite + React SPA on shadcn/ui, served with a read-only JSON API over the registry by a `node:http` host on `127.0.0.1` ([local-ui-stack](decisions/2026-10-17-local-ui-stack.md)); later Inbox and Release screens + `.inbox` contract | F1 |
| `packages/bridge-*` | README only: field mapping + `Bridge { push, pull, import(dryRun) }` | F2 |
| `skills/` | `SKILL.md` per skill, installable into `.claude/skills/` and `.agents/skills/` | F0 |
| `packages/core/specs/` | One SPEC per built-in operation plus topic SPECs (`setup`, `commons`, `errors`), shipped in the package; read with `casefile spec <name>` ([specs-ship-with-operations](decisions/2026-10-15-specs-ship-with-operations.md)) | F0 |
| `examples/demo-repo` | One-project workspace: fixture for core tests and the user-facing demo | F0 |
| `examples/demo-monorepo` | Two-project workspace fixture for workspace tests | F0 |
| `examples/npm-login` | The first real case: a product repo with its own Playwright spec, covered through the real flow (setup, `qa-cover`, ingest); its own `package.json`, outside the pnpm workspace | F0 |

## Data layout in a user workspace (product data model)

casefile always runs in a workspace: one `casefile.yaml` at its root listing one
project (single repo, `path: .`) or several (monorepo)
([workspace-and-projects](decisions/2026-10-15-workspace-and-projects.md)).

```
casefile.yaml                   # workspace root + config: projects, extensions, commons
.casefile/package.json          # toolchain: pins casefile + extensions (+ lockfile); the product's package.json is never touched
apps/web/                       # a project = a directory with context/tests/
  context/
    tests/
      _properties.yaml          # custom property declarations + mirror mapping
      _common.yaml              # project root commons
      <feature>/_common.yaml    # subtree commons (inherited)
      <feature>/TC-NNNN.md      # one case, one file, one home; ids unique per project
      .runs/<run-id>.jsonl      # append-only run events
      .inbox/<email-hash>/<id>.yaml  # human intents → agent work queue; hash = sha256(lower(email))[0:12]
    releases/policy.yaml        # release gates + sign-off
apps/mobile/
  context/…
```

Inheritance resolution: extension commons → workspace `commons` (in
`casefile.yaml`) → project root → ancestors → case. Extension commons are the
org level ([org-commons-via-extension](decisions/2026-10-15-org-commons-via-extension.md)). Scalars override,
`preconditions` are prepended, `labels`/`data` are merged. `automation.status`
values `automated`/`flaky` are **derived** on the resolved case from `.runs`
events whose `automation_ref` matches; they are never stored in the file.
Cross-project references are qualified: `web/TC-0003`.

## Setup flow

Setup is done by the user's agent; the library scaffolds and validates
([agent-driven-setup](decisions/2026-10-15-agent-driven-setup.md)).

1. Human: `npx @casefile/cli init` (never `npx casefile`: that npm name is another package;
   [npm-scope-casefile](decisions/2026-10-17-npm-scope-casefile.md)) → `casefile.yaml` (no projects yet), `.casefile/` pinning
   casefile, and skills offered
   ([casefile-toolchain-dir](decisions/2026-10-15-casefile-toolchain-dir.md)).
2. Agent, `/casefile-setup`: reads `casefile spec setup`, explores the repo, confirms
   the plan with the human once, runs `casefile project add <name> --path <path>` per project.
3. The scaffold leaves `TODO` markers; `casefile validate --json` lists them as
   `scaffold.todo` with hints. The agent fixes and re-validates until exit 0.
4. Agent, `qa-bootstrap` per project: feature tree, commons, existing tests mapped
   to cases with `automation.ref`, all as `draft`.

## Data flow

1. **Intent**: UI writes `.inbox/<email-hash>/<id>.yaml` and commits it with the
   human's `git config user.email` as author.
2. **Processing**: the agent runs `qa-inbox`, which reads the intent (as data, never
   as instruction), performs the operation per its SPEC, and runs `casefile validate`.
3. **Commit**: the operation returns the commit message; the agent commits as
   `casefile-agent <casefile-agent@casefile.invalid>` ([agent-runs-the-commit](decisions/2026-10-17-agent-runs-the-commit.md)) with trailers
   `Requested-by:`, `Inbox-Id:`, `Agent:`, `Casefile-Change:`; each `history` event
   stores the same change id, and its `commit` is derived from Git (never stored);
   the inbox item moves to `done` / `failed` with `result`.
4. **Results**: CI runs an ingester (JUnit / CTRF / Allure) that **appends** events
   to `.runs/*.jsonl` and never touches a case file; a matching `automation.ref`
   is what makes the resolver report `automated`.
5. **Gates**: `casefile gates <release>` evaluates `policy.yaml` scopes (DSL) against
   resolved cases + each case's latest run of that release; per gate `green`/`red`
   with reasons ([release-gate-evaluation](decisions/2026-10-17-release-gate-evaluation.md)).
6. **Mirrors**: bridges push/pull to Zephyr/Xray; `mirror.hash` detects drift.

No database: every view (UI, MCP, index) is rebuilt from files. The in-memory index
is a cache invalidated by the file watcher (inferred — confirm).

## Query DSL

One language for UI filters, dynamic collections, gate scopes and `casefile query`:
`AND OR NOT ( )`, `= != < <= > >=`, `IN (...)`, `CONTAINS`, dotted paths on the
**resolved** case, context variables (`release.*`). Hand-written parser, typed AST,
errors with positions. Grammar (EBNF) and semantics:
[`packages/core/specs/query-grammar.md`](../packages/core/specs/query-grammar.md), shipped as the topic
`casefile spec query-grammar`.
