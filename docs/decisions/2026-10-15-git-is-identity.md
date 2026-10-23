# Git is identity

## Status

Accepted — 2026-10-15 (from the founding brief). The `casefile-agent` identity and who runs
the commit: [agent-runs-the-commit](2026-10-17-agent-runs-the-commit.md). The CI identity
`casefile-ci`: [ci-commits-run-files](2026-10-17-ci-commits-run-files.md). Amended by
[identity-override](2026-10-23-identity-override.md): the person's email is resolved
flag → `CASEFILE_USER_EMAIL` → `git config user.email`.

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
