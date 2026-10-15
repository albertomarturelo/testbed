# Single query DSL

## Status

Accepted — 2026-10-15 (from the founding brief)

## Context

UI filters, dynamic collections, gate scopes and the CLI all need to select cases.

## Decision

One hand-written DSL (AND/OR/NOT, comparisons, IN, CONTAINS, dotted paths, `release.*` context variables) evaluated on the resolved case, with a typed AST and positioned errors. No heavy parser dependency.

## Alternatives Considered

- **JSONPath / JMESPath** — off-the-shelf, but awkward for boolean filters and user-facing errors.
- **Parser generator (e.g. PEG library)** — extra dependency for a small grammar.
- **Separate syntaxes per surface** — guaranteed drift.

## Consequences

- Grammar changes are versioned decisions.
- Exhaustive DSL tests are part of the core coverage target.
