# Stack — casefile

> No dependency files exist yet. Versions are recorded here **when the first
> `package.json` / lockfile lands**; until then each entry is "planned" and taken
> from the founding brief. Do not invent versions.

| Area | Choice | Version | Source |
|---|---|---|---|
| Language | TypeScript, `strict`, ESM only | TBD at install | brief |
| Runtime | Node.js | `>=22` (engines) | brief |
| Package manager | pnpm workspaces | TBD (local: 10.33.2) | brief |
| Task runner | Turborepo | TBD at install | brief |
| Tests | Vitest (+ coverage) | TBD at install | brief |
| Lint / format | Biome | TBD at install | brief |
| Schemas | JSON Schema 2020-12 + Zod (equivalent types) | TBD at install | brief |
| Markdown frontmatter | gray-matter | TBD at install | brief |
| YAML | `yaml` | TBD at install | brief |
| File watching | chokidar | TBD at install | brief |
| MCP | Official MCP TypeScript SDK (stdio + Streamable HTTP) | TBD at install | brief |
| License | MIT | — | brief |

Not used, by decision: any LLM SDK, database, Docker, auth provider, UI framework
(UI arrives in F1 with its own ADR).
