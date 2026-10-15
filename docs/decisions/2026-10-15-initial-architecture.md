# Initial architecture

## Status

Accepted — 2026-10-15. Module map amended by [apps-vs-packages](2026-10-15-apps-vs-packages.md).

## Context

casefile is a greenfield MIT framework that keeps test cases as files in the product
repo and lets an AI agent maintain them while a human QA orchestrates. The founding
brief fixes the stack (TypeScript/npm, pnpm + Turborepo, Node ≥ 22, Vitest, Biome)
and a phased roadmap: F0 core + CLI + skills, F1 local UI, F2 Zephyr/Xray bridges +
full MCP, F3 signed certificates + multi-repo workspace, F4 hosted (out of scope).

## Decision

- Monorepo with `packages/core` as the only package holding logic; `cli`, `mcp`,
  `ui` and `bridge-*` are thin surfaces over it. See [ARCHITECTURE](../ARCHITECTURE.md).
- Every file format is defined twice: JSON Schema 2020-12 (published, language-neutral)
  and Zod (runtime types).
- The repo's own CFD context lives in `docs/` (CFD standard), not `context/` as the
  brief proposed; `context/` is reserved for the **product's** data layout in user repos,
  to avoid two meanings for the same folder in this repo.
- ADRs use `YYYY-MM-DD-<slug>` ids (CFD), replacing the brief's `0001-…` numbering.
- `examples/demo-repo` is both the user-facing demo and the core test fixture.

## Alternatives Considered

- **Single package** — simpler, but mixes the MCP SDK and CLI deps into consumers that
  only need the library.
- **Zod only, generate JSON Schema** — one source, but generated schemas are harder
  to review as a public contract; rejected for F0, may revisit.
- **Keep `context/` for this repo's own docs** — matches the brief, but collides with
  the product layout `context/tests/` and with the CFD standard the maintainer chose.

## Consequences

- Core coverage targets (≥ 85 % on resolver, DSL, gates) are enforceable in one place.
- Schema drift between JSON Schema and Zod must be guarded by a test.
- Docs that mention `context/specs/` or numbered ADRs in the brief are superseded.
