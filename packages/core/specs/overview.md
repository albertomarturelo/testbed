# overview

Lists every project with its resolved cases: feature, state, priority,
automation status and latest run. The local UI's case list is built from it.
It never writes.

- **Actor:** human, agent, CI
- **CLI:** `casefile overview [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `project` | project name | Only that project. Filled by the host from `--project` or the project containing `--cwd`; absent: every project. |

## Output

```json
{ "projects": [{ "name": "web", "path": "apps/web", "cases": 2, "unresolved": 0 }],
  "cases": [{ "ref": "web/TC-0001", "project": "web", "feature": "login",
              "title": "Sign in with valid credentials", "state": "active",
              "priority": "P1", "automation": "automated",
              "last_run": "passed", "last_run_at": "2026-10-14T07:00:00Z" }] }
```

- `projects` come in `casefile.yaml` order; `cases` in project, then path order.
- `feature` is the case's `feature` field, its directory under `context/tests/`
  (`checkout/payments`; ADR feature-tree-not-calendar).
- `automation` is the resolved status: `automated` and `flaky` are derived from
  runs, never stored (ADR write-ownership).
- `last_run` / `last_run_at` are the status and time of the case's latest run
  event in its project's `.runs/`, whatever the status or executor; `null` when
  the case never ran. Release gates use their own rule (`casefile spec gates`
  once it exists, ADR release-gate-evaluation).
- `unresolved` counts case files that do not resolve (a required field is set
  nowhere). They are left out of `cases`; `casefile validate` says why.

## Errors

| Code | When |
|---|---|
| `project.unknown` | `project` names no project |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
