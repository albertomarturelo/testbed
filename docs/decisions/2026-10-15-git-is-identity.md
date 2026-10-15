# Git is identity

## Status

Accepted — 2026-10-15 (from the founding brief)

## Context

casefile needs authorship and accountability without running an auth service.

## Decision

No login. A human is their `git config user.email`. Intents are committed with the human as author; agent changes are committed as `casefile-agent` with trailers `Requested-by:`, `Inbox-Id:`, `Agent:` (plus `Casefile-Change:`, added by [history-commit-reference](2026-10-15-history-commit-reference.md)). `casefile init` recommends SSH commit signing; signing is mandatory only for `release sign`.

## Alternatives Considered

- **Built-in user accounts / OAuth** — adds auth infrastructure the brief rules out.
- **Agent commits as the human** — loses the distinction between decision and execution.

## Consequences

- Unsigned identity is spoofable; trust-critical actions (release sign-off) require signatures.
- `history[]` events link to commits through a `Casefile-Change:` trailer; `commit` is derived, not stored — see [history-commit-reference](2026-10-15-history-commit-reference.md).
