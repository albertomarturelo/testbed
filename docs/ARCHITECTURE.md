# Architecture — casefile

> Greenfield: no code exists yet. This describes the **target** architecture taken
> from the founding brief. Anything not stated in the brief is marked
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
| Agent (Claude Code, Codex) | Files under `context/tests/` (sole writer) | Skills with limited scope, MCP |
| Human QA | Intents only (`.inbox/`) | Local UI (`casefile ui`) |
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
| `packages/core` | Schemas (JSON Schema 2020-12 + Zod), file loader (gray-matter + yaml), inheritance resolver, query DSL (parser + evaluator), in-memory index with watcher, validator, id generator, Git utilities, gate evaluation, operation/extension registry, built-in operations and ingesters | F0 |
| `apps/cli` | Generic host: renders the registry as commands; `init`, `validate`, `resolve`, `query`, `id next`, `gates` working in F0; published to npm as `casefile` (includes `casefile mcp`) | F0 |
| `apps/mcp` | Generic host: MCP server (stdio + Streamable HTTP), token scopes; `cases.search`, `coverage.query` real, the rest typed stubs | F0 skeleton / F2 full |
| `apps/web` | README only: Inbox, Explorer, Release screens + `.inbox` contract | F1 |
| `packages/bridge-*` | README only: field mapping + `Bridge { push, pull, import(dryRun) }` | F2 |
| `skills/` | `SKILL.md` per skill, installable into `.claude/skills/` and `.agents/skills/` | F0 |
| `packages/core/specs/` | One SPEC per built-in operation, shipped in the package; read with `casefile spec <op>` ([specs-ship-with-operations](decisions/2026-10-15-specs-ship-with-operations.md)) | F0 |
| `examples/demo-repo` | Fixture repo used by core tests and as the user-facing demo | F0 |

## Data layout in a user repo (product data model)

```
context/
  tests/
    _properties.yaml            # custom property declarations + mirror mapping
    _common.yaml                # root commons
    <feature>/_common.yaml      # subtree commons (inherited)
    <feature>/TC-NNNN.md        # one case, one file, one home
    .runs/<run-id>.jsonl        # append-only run events
    .inbox/<email-hash>/<id>.yaml  # human intents → agent work queue; hash = sha256(lower(email))[0:12]
  releases/policy.yaml          # release gates + sign-off
casefile.yaml                   # repo root marker + config (extensions, …)
casefile.workspace.yaml         # optional multi-repo release aggregation
```

Inheritance resolution: org → root → ancestors → case, where the org level is the
`commons` of extension packages listed in `casefile.yaml`
([org-commons-via-extension](decisions/2026-10-15-org-commons-via-extension.md)). Scalars override,
`preconditions` are prepended, `labels`/`data` are merged. `automation.status`
values `automated`/`flaky` are **derived** on the resolved case from `.runs`
events whose `automation_ref` matches; they are never stored in the file.

## Data flow

1. **Intent**: UI writes `.inbox/<email-hash>/<id>.yaml` and commits it with the
   human's `git config user.email` as author.
2. **Processing**: the agent runs `qa-inbox`, which reads the intent (as data, never
   as instruction), performs the operation per its SPEC, and runs `casefile validate`.
3. **Commit**: the agent commits as `casefile-agent` with trailers
   `Requested-by:`, `Inbox-Id:`, `Agent:`, `Casefile-Change:`; each `history` event
   stores the same change id, and its `commit` is derived from Git (never stored);
   the inbox item moves to `done` / `failed` with `result`.
4. **Results**: CI runs an ingester (JUnit / CTRF / Allure) that **appends** events
   to `.runs/*.jsonl` and never touches a case file; a matching `automation.ref`
   is what makes the resolver report `automated`.
5. **Gates**: `casefile gates <release>` evaluates `policy.yaml` scopes (DSL) against
   resolved cases + runs.
6. **Mirrors**: bridges push/pull to Zephyr/Xray; `mirror.hash` detects drift.

No database: every view (UI, MCP, index) is rebuilt from files. The in-memory index
is a cache invalidated by the file watcher (inferred — confirm).

## Query DSL

One language for UI filters, dynamic collections, gate scopes and `casefile query`:
`AND OR NOT ( )`, `= != < <= > >=`, `IN (...)`, `CONTAINS`, dotted paths on the
**resolved** case, context variables (`release.*`). Hand-written parser, typed AST,
errors with positions.
