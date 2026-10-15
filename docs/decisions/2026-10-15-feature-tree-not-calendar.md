# Feature tree, not calendar

## Status

Accepted — 2026-10-15 (from the founding brief)

## Context

Organizing cases by sprint or release scatters one behavior across many folders over time.

## Decision

One case, one file, one home: `context/tests/<feature>/<id>.md`. The tree mirrors the product. Sprints, stories and releases are associations in `work_items` (`sprint:23`, `story:PROJ-1234`, `release:web-4.12.0`).

## Alternatives Considered

- **Folders per sprint/release** — mirrors common tool habits, causes copies and drift.
- **Flat folder + tags only** — loses inheritance via `_common.yaml`.

## Consequences

- Commons inheritance follows the feature tree.
- Sprint/release views are queries (DSL), not directories.
