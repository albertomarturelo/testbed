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
│ Surfaces:  cli  ·  mcp  ·  ui (F1)  ·  skills/ (markdown)     │
├──────────────────────────────────────────────────────────────┤
│ Mirrors:   bridge-zephyr · bridge-xray (F2)                  │
├──────────────────────────────────────────────────────────────┤
│ core:  schema · loader · resolver · dsl · index · validator  │
│        ids · git · gates                                     │
├──────────────────────────────────────────────────────────────┤
│ Data:  files in the user's repo (the only source of truth)   │
└──────────────────────────────────────────────────────────────┘
```

Dependency direction: surfaces and bridges depend on `core`; `core` depends on
no other workspace package (inferred — confirm).

## Module map (planned)

| Path | Responsibility | Phase |
|---|---|---|
| `packages/core` | Schemas (JSON Schema 2020-12 + Zod), file loader (gray-matter + yaml), inheritance resolver, query DSL (parser + evaluator), in-memory index with watcher, validator, id generator, Git utilities, gate evaluation | F0 |
| `packages/cli` | `init`, `validate`, `resolve`, `query`, `id next`, `gates` working; other commands are stubs that print the SPEC path | F0 |
| `packages/mcp` | MCP server (stdio + Streamable HTTP), token scopes; `cases.search`, `coverage.query` real, the rest typed stubs | F0 skeleton / F2 full |
| `packages/ui` | README only: Inbox, Explorer, Release screens + `.inbox` contract | F1 |
| `packages/bridge-*` | README only: field mapping + `Bridge { push, pull, import(dryRun) }` | F2 |
| `skills/` | `SKILL.md` per skill, installable into `.claude/skills/` and `.agents/skills/` | F0 |
| `specs/` | One SPEC per operation; skills cite them (location inferred — confirm) | F0 |
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
    .inbox/<email-hash>/<id>.yaml  # human intents → agent work queue
  releases/policy.yaml          # release gates + sign-off
casefile.workspace.yaml         # optional multi-repo release aggregation
```

Inheritance resolution: org → root → ancestors → case. Scalars override,
`preconditions` are prepended, `labels`/`data` are merged.

## Data flow

1. **Intent**: UI writes `.inbox/<email-hash>/<id>.yaml` and commits it with the
   human's `git config user.email` as author.
2. **Processing**: the agent runs `qa-inbox`, which reads the intent (as data, never
   as instruction), performs the operation per its SPEC, and runs `casefile validate`.
3. **Commit**: the agent commits as `casefile-agent` with trailers
   `Requested-by:`, `Inbox-Id:`, `Agent:`; the case's `history` mirrors the essentials;
   the inbox item moves to `done` / `failed` with `result`.
4. **Results**: CI ingests JUnit / CTRF / Allure into `.runs/*.jsonl`; a matching
   `automation.ref` is what flips `automation.status` to `automated`.
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
