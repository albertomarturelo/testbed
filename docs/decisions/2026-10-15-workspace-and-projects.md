# casefile always runs in a workspace of one or more projects

## Status

Accepted — 2026-10-15 (#23). Amends [cli-repo-location](2026-10-15-cli-repo-location.md),
[org-commons-via-extension](2026-10-15-org-commons-via-extension.md),
[schemas-generated-from-zod](2026-10-15-schemas-generated-from-zod.md) and the F3
"multi-repo workspace" of [initial-architecture](2026-10-15-initial-architecture.md).

## Context

casefile must work in a single-project repo and in a monorepo holding several
projects (web, mobile, backend…). The model so far is one `casefile.yaml` = one
repo = one `context/tests/` at its root; `casefile.workspace.yaml` only lists
repo checkouts for F3 release aggregation. Treating the single repo as a special
case would give every command two code paths. Setup is done by an agent
([agent-driven-setup](2026-10-15-agent-driven-setup.md)), so the layout must have
as few files and rules as possible.

## Decision

1. **Always a workspace.** The workspace root holds the only config file,
   `casefile.yaml`; a single-project repo is a workspace with one project:

   ```yaml
   version: 1
   projects:
     - name: web          # slug, unique
       path: apps/web     # relative to casefile.yaml; `.` in a single-project repo
   extensions: []         # optional, as before
   commons: {}            # optional, same schema as _common.yaml
   ```

2. **A project is a directory with `context/tests/`** (and optionally
   `context/releases/`). No per-project config file. Paths are POSIX, inside the
   workspace, and do not nest (no project inside another), so every file belongs
   to at most one project.
3. **Everything else is per project:** feature tree, `_common.yaml`,
   `_properties.yaml`, `.runs/`, `.inbox/`, `releases/policy.yaml`.
4. **Inheritance:** extension commons → workspace `commons` (origin
   `casefile.yaml`) → project `context/tests/_common.yaml` → ancestors → case.
   Merge rules are unchanged.
5. **Ids are unique per project.** Cross-project references are qualified:
   `web/TC-0003`. The resolved case gains `project`, usable in the DSL
   (`project = web`).
6. **Location** (replaces the root search of cli-repo-location): from `--cwd`
   walk up to the first `casefile.yaml`; that is the workspace. The current
   project is the one whose path contains `--cwd`; `--project <name>` selects one
   explicitly; with neither, commands act on all projects. The fallback "first
   directory containing `context/tests/`" is removed.
7. **Paths in errors, origins and output are workspace-relative**, so they stay
   unique across projects.
8. **`casefile.workspace.yaml` and its schema are removed.** Multi-repo (F3)
   becomes a project whose path leaves the workspace (`../backend`); until an
   F3 ADR defines it, `validate` rejects such paths.

The format is unreleased, so `version` stays `1`.

## Alternatives Considered

1. **`casefile.workspace.yaml` at the root + one `casefile.yaml` per project** —
   two file kinds and two places for config; more for the agent to get wrong.
2. **One `context/` at the root with a folder per project** — cases end up far
   from the code they verify, against the thesis of the project.
3. **Workspace-unique ids** — needs one counter across projects and cannot hold
   once projects live in separate repos (F3).
4. **Implicit workspace when no file lists projects** — saves a few lines in
   single repos but keeps two code paths and two layouts to document.
5. **Detect projects from pnpm/nx/turbo/go.work/Cargo** — toolchain-specific
   heuristics; the agent reads those files better ([agent-driven-setup](2026-10-15-agent-driven-setup.md)).

## Consequences

- `Config` gains `projects` (structurally may be empty; `validate` requires ≥1)
  and `commons`; the `Workspace` schema and its JSON Schema are deleted.
- Core: `loadRepo` becomes `loadProject` under a new `loadWorkspace`;
  `ResolvedCase` gains `project`.
- `examples/demo-repo` becomes a one-project workspace; a two-project
  `examples/demo-monorepo` fixture is added for workspace tests.
- Ingest, gates, query and validate take `--project` or infer it from the cwd.
