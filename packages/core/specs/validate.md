# validate

Checks the whole workspace and lists every problem with enough detail to fix
it. It is the oracle of the setup loop: run it until it exits 0. It never
writes.

- **Actor:** human, agent, CI
- **CLI:** `casefile validate [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `project` | project name | Only that project's findings, plus the workspace-level ones (`casefile.yaml`, `.casefile/`). Filled by the host from `--project` or the project containing `--cwd`; absent means every project. Ignored when `casefile.yaml` cannot be read: its findings come back whole. |

## Behaviour

1. Loads the workspace, the toolchain in `.casefile/` and the extensions
   `casefile.yaml` lists.
2. Runs the checks in levels: workspace → file schemas → cross-file →
   resolution → environment. A level with an error stops the later levels for
   its scope (the whole workspace, or one project), so a broken `casefile.yaml`
   yields one finding, not hundreds.
3. Findings come in a deterministic order: level by level, then by path, line,
   field and code.

## Output

With no errors (warnings allowed) it succeeds:

```json
{ "projects": 1, "cases": 8, "warnings": 1,
  "findings": [{ "code": "toolchain.unpinned", "severity": "warning",
                 "path": ".casefile/package.json", "message": "…", "hint": "…" }] }
```

With any error it fails, and the errors are **every** finding, warnings
included, each with `severity`. On the CLI: exit 0 / 1, or 2 without a
workspace; `--json` prints `{ "ok": false, "errors": [ … ] }`.

A finding has `code`, `severity`, workspace-relative `path`, `message`, and
`line`, `field`, `expected`, `hint`, `spec` when known. Fix the first finding of
each file first: later ones may be consequences of it.

## Errors

| Code | When |
|---|---|
| any finding code | the workspace has at least one error-level finding |
| `project.unknown` | `project` names no project in `casefile.yaml` |
| `workspace.missing` | no `casefile.yaml` at or above `--cwd` (CLI exit 2); the human runs `casefile init` |

## Next

Fix the findings and run it again; `scaffold.todo` findings are the decisions
the setup still has to make.
