# Build and test tooling for the monorepo

## Status

Accepted — 2026-10-15 (#4). §1 amended by [local-ui-stack](2026-10-17-local-ui-stack.md):
Vite bundles the `apps/web` client only.

## Context

The brief fixes pnpm workspaces, Turborepo, TypeScript strict ESM, Vitest and
Biome, but not how they are wired: how packages are built, how tests run, how
versions are chosen, and how the `apps/* → apps/*` ban of
[apps-vs-packages](2026-10-15-apps-vs-packages.md) is enforced.

## Decision

1. **Build with `tsc` only, no bundler.** Each workspace has `tsconfig.json`
   (type-checks `src/` including tests, `noEmit`) and `tsconfig.build.json`
   (emits `dist/` with declarations, excludes `*.test.ts`). Turborepo runs
   `build` and `typecheck` in dependency order.
2. **One Vitest run at the root** using Vitest `projects` over `packages/*` and
   `apps/*`. Tests run from `src/` (no build needed); coverage with
   `@vitest/coverage-v8`. Turborepo is not used for tests.
3. **Exact versions, at least 7 days old** when added or upgraded; no `^`/`~`
   ranges in this repo's `devDependencies`. The lockfile is committed and CI
   installs with `--frozen-lockfile`.
4. **Package names:** `@casefile/core`, `@casefile/mcp` (both `private: true`
   until a publishing decision), and `casefile` for `apps/cli`, the only
   package intended for npm in F0.
5. **Boundary check** `scripts/check-boundaries.mjs` (Node, no dependency), run
   by `pnpm lint`: fails if an app declares another app as a dependency or
   imports a path inside another app.
6. **Turborepo agent guidance is off** (`"agentGuidance": false` in `turbo.json`).
   Turborepo 2.11 otherwise rewrites `AGENTS.md` with its own block when it
   detects an agent, replacing the CFD symlink with a drifting copy.
7. **CI**: GitHub Actions on Node 22 and 24 (the supported range starts at 22):
   install → build → typecheck → lint → test.

## Alternatives Considered

- **tsup / esbuild / Rolldown bundling** — faster builds and single-file output,
  but another tool and source maps to debug; `tsc` output is enough for a
  Node-only CLI and library. Revisit if startup time of `casefile` matters.
- **TypeScript project references (`tsc -b`)** — the canonical monorepo setup,
  but duplicates what Turborepo already orders; more config per package.
- **Vitest per package through Turborepo** — cacheable, but N processes and N
  coverage reports to merge for the ≥ 85 % target.
- **Biome `noRestrictedImports` for boundaries** — needs a hand-maintained list
  of app package names per override; misses relative imports across folders.
- **dependency-cruiser / Nx module boundaries** — powerful, but a dependency for
  one rule.
- **Caret ranges** — easier upgrades, but a fresh release can land unreviewed.

## Consequences

- Upgrades are deliberate PRs that touch `docs/STACK.md`.
- Adding a workspace means adding both tsconfig files and a `build` script; the
  root Vitest config picks it up by glob.
