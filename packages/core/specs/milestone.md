# milestone

A milestone groups executions, like a GitHub milestone groups issues: a
release to certify, a sprint regression, a UAT round, an audit. Each one is a
file, `context/milestones/<slug>.yaml` in its project; `casefile run` and
`casefile ingest` name it with `--milestone <slug>`, and a case runs in any
number of milestones. Closing a milestone freezes the evidence of what was
executed in it (ADR milestones-group-executions).

- **Actor:** agent, human
- **CLI:** `casefile milestone open <slug> --title <title> [--due <YYYY-MM-DD>] [--release <version>] [--scope '<query>'] [--agent <name>] [--ticket <key>] [--project <name>] --json`
  (an agent runs it with `CASEFILE_ACTOR=agent`; read `commit` from the `--json` output)
- **Writes:** `**/context/milestones/*.yaml` (a new file only)

## The file

```yaml context/milestones/web-1.2.0.yaml
title: Web 1.2.0
state: open
due: 2026-10-20
release: web-1.2.0
scope: priority IN (P0, P1) and state = active
opened:
  at: "2026-10-10T09:00:00Z"
  by: qa@acme.example
  change: 3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44
```

| Field | Meaning |
|---|---|
| `title` | One line, shown in the viewer. |
| `state` | `open` while executions may name it; `closed` once its evidence is frozen. |
| `due` | Optional date. |
| `release` | Optional: the version or Git tag the milestone certifies. |
| `scope` | Optional query of the cases it covers (`casefile spec query-grammar`); default `state = active`. |
| `opened` | Who opened it, when, and the change id of that commit. |

The slug is the file name: letters, digits and `._-`, starting with a letter or
digit (`web-2.1.0`, `sprint-23`). `casefile validate` reports a file that does
not match this shape.

## open

1. Finds the project (`project.required`, `project.unknown`).
2. Refuses a slug the project already has (`milestone.exists`) and a `scope`
   that does not parse (`milestone.invalid_scope`, with the query error).
3. Builds the commit subject from the workspace's template (`casefile spec
   cover`, *Commit subject*): type `test`, scope the project, summary
   `open milestone <slug>`, by default `test(web): open milestone web-1.2.0`.
4. Writes the file with `state: open` and `opened`, and returns the commit of
   that one file, like `cover` (`Requested-by:`, `Agent:` unless
   `commit.agent_trailer` is `false`, `Casefile-Change:`).

Nothing is written when an error is returned.

## Naming it in an execution

`casefile run` and `casefile ingest` take `--milestone <slug>`. The milestone
must be declared and open in the case's project:

- `milestone.unknown`: no such file; the message lists the open ones.
- `milestone.closed`: it is closed; its evidence must not change.

The event stores `milestone`. Within a milestone a case's latest result counts,
as for release gates; gate scopes read `milestone.name` and `milestone.build`.

**Before `0.2.0`** the field was `release`. Old run files keep it (they are
never rewritten) and are read as `milestone`; `--release` still works as
`--milestone` with a deprecation notice in `next`, and gate scopes still accept
`release.name` and `release.build`. `casefile validate` warns about events that
name a milestone no file declares (`run.undeclared_milestone`): open it with
the same slug to group them.

## Output

```json
{ "project": "web",
  "slug": "web-1.2.0",
  "path": "apps/web/context/milestones/web-1.2.0.yaml",
  "change": "3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44",
  "commit": {
    "author": "casefile-agent <casefile-agent@casefile.invalid>",
    "message": "test(web): open milestone web-1.2.0\n\nRequested-by: qa@acme.example\nAgent: claude-code\nCasefile-Change: 3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44\n",
    "files": ["apps/web/context/milestones/web-1.2.0.yaml"] },
  "next": ["Commit the file …", "Record executions in it: casefile run <ref> --status <status> --milestone web-1.2.0"] }
```

## Errors

| Code | When |
|---|---|
| `milestone.exists` | the project already has a milestone with that slug |
| `milestone.invalid_scope` | `scope` does not parse as a query |
| `milestone.unknown` / `milestone.closed` | (`run`, `ingest`) the named milestone is not declared, or is closed |
| `milestone.agent_required` / `milestone.agent_not_allowed` | as in `casefile spec cover` |
| `commit.ticket_*`, `config.commit_*` | the subject template, as in `casefile spec cover` |
| `project.required` / `project.unknown` | as in `casefile spec cover` |
| `operation.actor_not_allowed` | invoked by CI |
