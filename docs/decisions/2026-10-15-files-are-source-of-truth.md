# Files are the source of truth

## Status

Accepted — 2026-10-15 (from the founding brief)

## Context

Test-management tools and UIs tend to accumulate state that diverges from the code they describe.

## Decision

Files in the user's repo are the only source of truth. UI, MCP, index and bridges are views or mirrors; no hidden database may diverge from the repo.

## Alternatives Considered

- **Local SQLite/DB as primary store** — fast queries, but creates a second truth and breaks review-by-diff.
- **Vendor platform as primary (Zephyr/Xray)** — status quo the project exists to replace.

## Consequences

- Every derived view must be recomputable from files; performance comes from an in-memory index, not persistence.
- Code review, blame and branching apply to test cases for free.
