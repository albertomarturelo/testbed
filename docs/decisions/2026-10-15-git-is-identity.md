# Git is identity

## Status

Accepted — 2026-10-15 (from the founding brief)

## Context

casefile needs authorship and accountability without running an auth service.

## Decision

No login. A human is their `git config user.email`. Intents are committed with the human as author; agent changes are committed as `casefile-agent` with trailers `Requested-by:`, `Inbox-Id:`, `Agent:`. `casefile init` recommends SSH commit signing; signing is mandatory only for `release sign`.

## Alternatives Considered

- **Built-in user accounts / OAuth** — adds auth infrastructure the brief rules out.
- **Agent commits as the human** — loses the distinction between decision and execution.

## Consequences

- Unsigned identity is spoofable; trust-critical actions (release sign-off) require signatures.
- Open question: how `history[].commit` references a commit that contains it (see #2).
