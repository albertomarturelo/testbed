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
| `@casefile/core` | `yaml` | runtime | 2.9.1 | YAML files and case frontmatter ([frontmatter-without-gray-matter](decisions/2026-10-15-frontmatter-without-gray-matter.md)) |
| `@casefile/cli` (`apps/cli`) | `@casefile/core` | runtime | `workspace:*` | The registry the CLI renders (ADR cli-generic-host) |
| `@casefile/cli` (`apps/cli`) | `zod` | dev | 4.6.5 | Test-only operation inputs for the argv rules; same version as core |
| `@casefile/web` | `@casefile/core` | runtime | `workspace:*` | The registry the UI's API runs ([local-ui-stack](decisions/2026-10-17-local-ui-stack.md)) |
| `@casefile/web` | `react`, `react-dom` | dev (bundled) | 19.3.0 | Client UI |
| `@casefile/web` | `@types/react`, `@types/react-dom` | dev | 19.3.0 | Client types |
| `@casefile/web` | `vite` | dev | 8.3.4 | Builds the client only (amends build-and-test-tooling §1) |
| `@casefile/web` | `@vitejs/plugin-react` | dev | 6.1.2 | JSX and React refresh in Vite and Vitest |
| `@casefile/web` | `tailwindcss`, `@tailwindcss/vite` | dev | 4.3.3 | Styles for shadcn/ui |
| `@casefile/web` | `radix-ui` | dev (bundled) | 1.7.0 | Primitives behind the shadcn components |
| `@casefile/web` | `class-variance-authority` | dev (bundled) | 0.7.1 | shadcn component variants |
| `@casefile/web` | `clsx` | dev (bundled) | 2.1.1 | `cn()` class joining |
| `@casefile/web` | `tailwind-merge` | dev (bundled) | 3.7.0 | `cn()` utility conflicts |
| `@casefile/web` | `lucide-react` | dev (bundled) | 1.54.0 | Icons (shadcn default) |
| `@casefile/web` | `tw-animate-css` | dev (bundled) | 1.4.0 | Animations the shadcn components use |
| `@casefile/web` | `happy-dom`, `@testing-library/react` | dev | 20.14.6, 16.3.3 | Client smoke tests |

shadcn/ui itself is not a dependency: its CLI (`shadcn@4.21.4`, run with
`pnpm dlx`) copies components into `apps/web/src/client/components/ui/` (CONVENTIONS 13).

## Platform

| Area | Choice |
|---|---|
| Runtime | Node.js `>=22` (CI: 22 and 24) |
| Package manager | pnpm 10.33.2 (`packageManager` field), workspaces `apps/*`, `packages/*` |
| Module system | ESM only, `module`/`moduleResolution` `NodeNext`, target ES2023 |
| CI | GitHub Actions: `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7` |
| License | MIT |

## Workflow tooling

| Area | Choice | Version |
|---|---|---|
| CFD skills, hooks, context CI | Vendored from `albertomarturelo/context-first-development` | `bf55ab8ddc65` |
| Hook dependency | `jq` (commit guard fails open without it) | system |

## Planned (added only when first used)

| Area | Choice | Lands with |
|---|---|---|
| File watching | chokidar | #9 |
| MCP | Official MCP TypeScript SDK (stdio + Streamable HTTP) | #15 |

Not used, by decision: any LLM SDK, database, Docker, auth provider, a bundler
outside the `apps/web` client, an HTTP server framework (`node:http` serves the UI),
a client router or state library (needs an ADR), gray-matter (frontmatter is split in core).
