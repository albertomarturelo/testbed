# CLI locates the repo with --cwd, positionals are the subject

## Status

Accepted — 2026-10-15 (#3). Root search amended by
[workspace-and-projects](2026-10-15-workspace-and-projects.md): walk up to `casefile.yaml`
(the workspace) only; the project comes from the path or `--project`.

## Context

The brief mixes `casefile validate examples/demo-repo` (positional path) with
`casefile resolve TC-0003 --cwd examples/demo-repo`. Under
[extension-model](2026-10-15-extension-model.md) the CLI is a generic host that
derives arguments from each operation's input schema, so it needs one rule.

## Decision

- **`--cwd <dir>` is a global option** on every command; default `process.cwd()`.
- From that directory core walks **up** to the repo root: the first directory
  containing `casefile.yaml`; if none, the first containing `context/tests/`.
  No root found → exit code 2 with a message suggesting `casefile init`.
- **Positionals are reserved for the operation's subject**: a case id, a query,
  a release ref (`resolve TC-0003`, `query "…"`, `gates release:web-1.2.0`).
  An operation marks at most one input field as `subject`; everything else is a flag.
- `casefile validate examples/demo-repo` becomes
  `casefile validate --cwd examples/demo-repo`.

## Alternatives Considered

- **Positional path on `validate` only** — one exception today, more as
  operations are added; generic hosts cannot infer it.
- **Environment variable (`CASEFILE_ROOT`)** — invisible in command lines and
  logs; can be added later as a fallback for `--cwd` if needed.
- **No upward search** — forces users to run from the root; worse in monorepos.

## Consequences

- #11 acceptance criterion changes to `pnpm casefile validate --cwd examples/demo-repo`.
- The MCP host ignores `--cwd`: its root is fixed at server start.
