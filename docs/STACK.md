# Stack — casefile

Versions are exact and at least 7 days old when added
([build-and-test-tooling](decisions/2026-10-15-build-and-test-tooling.md)).
Upgrades are deliberate PRs that update this table.

## Installed (root `devDependencies`, 2026-10-15)

| Area | Package | Version |
|---|---|---|
| Language | `typescript` (native compiler, `tsc`) | 7.0.2 |
| Node types | `@types/node` (pinned to the minimum supported Node line) | 22.20.5 |
| Task runner | `turbo` | 2.11.7 |
| Tests | `vitest` | 5.0.3 |
| Coverage | `@vitest/coverage-v8` | 5.0.3 |
| Lint / format | `@biomejs/biome` | 2.5.15 |

## Installed (workspace dependencies)

| Workspace | Package | Kind | Version | Why |
|---|---|---|---|---|
| `@casefile/core` | `zod` | runtime | 4.6.5 | Schemas; source of the generated JSON Schemas |
| `@casefile/core` | `ajv` | dev | 8.20.0 | Parity test of committed JSON Schemas (draft 2020-12) |

## Platform

| Area | Choice |
|---|---|
| Runtime | Node.js `>=22` (CI: 22 and 24) |
| Package manager | pnpm 10.33.2 (`packageManager` field), workspaces `apps/*`, `packages/*` |
| Module system | ESM only, `module`/`moduleResolution` `NodeNext`, target ES2023 |
| CI | GitHub Actions: `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7` |
| License | MIT |

## Planned (added only when first used)

| Area | Choice | Lands with |
|---|---|---|
| Markdown frontmatter | gray-matter | #7 |
| YAML | `yaml` | #7 |
| File watching | chokidar | #9 |
| MCP | Official MCP TypeScript SDK (stdio + Streamable HTTP) | #15 |

Not used, by decision: any LLM SDK, database, Docker, auth provider, bundler,
UI framework (UI arrives in F1 with its own ADR).
