# Apps are independent hosts over core

## Status

Accepted — 2026-10-15. Amends [initial-architecture](2026-10-15-initial-architecture.md)
(module map). Package names amended by
[npm-scope-casefile](2026-10-17-npm-scope-casefile.md): `apps/cli` is `@casefile/cli`.

## Context

The maintainer wants CLI, MCP server and web UI to be independent entities: each
usable, built and (eventually) published on its own, none requiring another to run.
The initial module map placed them all under `packages/` next to `core`, which
blurs the line between library code and deployable surfaces.

## Decision

```
apps/
  cli/            binary `casefile`
  mcp/            MCP server (stdio + Streamable HTTP)
  web/            local UI (F1)
packages/
  core/           schemas, loader, resolver, DSL, index, validator, gates, git,
                  operation registry — the only write path
  bridge-*/       mirrors (F2)
```

Rules:

1. An app depends on `packages/*` only, never on another app.
2. Apps coordinate through files and Git, never through each other. The web UI
   writes an `.inbox` intent; the agent processes it through the CLI or MCP. No
   app needs another to be running.
3. Apps are **generic hosts**: they expose whatever the operation registry
   declares (see [extension-model](2026-10-15-extension-model.md)) and contain
   no operation logic of their own.
4. Publishing: in F0 only `apps/cli` is published to npm as `casefile`, with the
   MCP server reachable as `casefile mcp`. Separate packages for `mcp`/`web`
   are a later decision, taken when there is a consumer for them.

## Alternatives Considered

- **Everything under `packages/`** (initial ADR) — simpler layout, but no
  structural signal that apps must not import each other.
- **Separate repositories per app** — maximal independence, but the F0 API of
  core is still moving; cross-repo versioning would dominate the work.
- **Publish every app separately from day one** — premature; no consumer yet.

## Consequences

- Turborepo/pnpm scaffold (#4) uses `apps/*` and `packages/*` globs.
- A lint/CI check must forbid `apps/* → apps/*` imports.
- `docs/ARCHITECTURE.md` module map updated.
