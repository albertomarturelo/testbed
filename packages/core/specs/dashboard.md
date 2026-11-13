# dashboard

A dashboard is a page of widgets over a project's cases and executions: how
many cases each feature has, which ones have no test, what a milestone's
results look like. Each one is a file, `context/dashboards/<slug>.yaml` in its
project, written whole from a JSON description, so it is built once and stays
(ADR dashboards-as-files). The viewer shows it; nobody arranges it by hand.

- **Actor:** agent, human (`list`: also CI)
- **CLI:**
  - `casefile dashboard save <slug> --spec '<json>' [--agent <name>] [--ticket <key>] [--project <name>] --json`
  - `casefile dashboard list [--project <name>] [--json]`
  - `casefile dashboard remove <slug> [--agent <name>] [--ticket <key>] [--project <name>] --json`

  (an agent runs `save` and `remove` with `CASEFILE_ACTOR=agent`; read `commit` from the `--json` output)
- **Writes:** `save`: `**/context/dashboards/*.yaml` (one file, new or replaced);
  `remove`: deletes that file; `list`: nothing

## The file

```yaml context/dashboards/overview.yaml
title: Overview
description: Where the cases are and which ones still have no test.
widgets:
  - id: total
    title: Cases
    type: stat
    query: NOT state = retired
    width: 3
  - id: by-state
    title: By state
    type: donut
    group_by: state
    width: 4
  - id: by-feature
    title: Active cases per feature
    type: bar
    query: state = active
    group_by: feature
    width: 5
  - id: no-test
    title: Can be automated, no test yet
    type: table
    query: automation.eligible = true AND automation.status = manual
    columns:
      - title
      - feature
      - priority
    limit: 20
  - id: executions
    title: Executions per day in Web 1.2.0
    type: timeseries
    milestone: web-1.2.0
```

| Field | Meaning |
|---|---|
| `title` | One line, shown in the viewer. |
| `description` | Optional text under the title. |
| `widgets` | 1 to 24 widgets, in reading order. |

The slug is the file name: letters, digits and `._-`, starting with a letter
or digit (`overview`, `web-2.1.0`).

## Widgets

Every widget has:

| Field | Meaning |
|---|---|
| `id` | A lowercase slug (`by-state`), unique in the dashboard. Keep it when you save the dashboard again. |
| `title` | One line. |
| `type` | `stat`, `bar`, `donut`, `table` or `timeseries`. |
| `query` | Optional: the cases the widget is about, in the query DSL over resolved cases (`casefile spec query-grammar`). Absent: every case of the project. |
| `milestone` | Optional: a declared milestone of the project. Results are then read inside it, and `query` may read `milestone.name` and `milestone.build`. |
| `width` | Optional: columns of 12 the widget spans. Widgets fill each row in order and stack on a narrow screen. There are no coordinates. |

And by type:

| Type | Shows | Its own fields |
|---|---|---|
| `stat` | The number of matching cases. | none |
| `bar` | Matching cases counted per value of `group_by`, as bars. | `group_by` (required) |
| `donut` | The same count as parts of a whole; for a handful of values. | `group_by` (required) |
| `table` | The matching cases, one row each, the case id first. | `columns` (1 to 8, required), `limit` (1 to 200) |
| `timeseries` | Executions of the matching cases per day, by status. | `days` (1 to 365; default 30, or the milestone's span) |

`group_by` and each of `columns` is a dotted path on the resolved case, the
same paths a query reads (`state`, `priority`, `feature`, `automation.status`,
`labels.risk`), or `last_result`: the case's latest execution (`passed`,
`failed`, `blocked`), inside `milestone` when the widget names one, `not_run`
when it has none. A case without a value at the path is counted under `(none)`.

The only measure is a count. A percentage, a sum or a formula is not something
a widget can express: ask for a new widget type instead of approximating one.

## save

`--spec` is the whole dashboard as JSON, with the fields above:

```json dashboard.json
{
  "title": "Web 1.2.0",
  "widgets": [
    {
      "id": "results",
      "title": "Latest result per case",
      "type": "donut",
      "query": "state = active",
      "milestone": "web-1.2.0",
      "group_by": "last_result",
      "width": 4
    },
    {
      "id": "failed",
      "title": "P0 and P1 in the milestone",
      "type": "table",
      "query": "priority IN (P0, P1) AND state = active",
      "milestone": "web-1.2.0",
      "columns": ["title", "priority", "last_result"],
      "width": 8
    }
  ]
}
```

1. Finds the project (`project.required`, `project.unknown`).
2. Checks the dashboard. A shape problem is `operation.invalid_input` with the
   field (`spec.widgets.1.group_by`). Then, each with its field:
   `dashboard.duplicate_widget` (two widgets share an id),
   `dashboard.unknown_milestone` (the project declares no such milestone),
   `dashboard.invalid_query` (the query does not parse, or reads `milestone.*`
   in a widget that names no milestone).
3. Refuses a dashboard equal to the file already there (`dashboard.no_change`).
4. Builds the commit subject from the workspace's template (`casefile spec
   cover`, *Commit subject*): type `test`, scope the project, summary
   `add dashboard <slug>` or `update dashboard <slug>`.
5. Writes the file whole, keys in the order shown above, and returns
   `created` (`false` when it replaced one) and the commit of that one file:
   `Requested-by:`, `Agent:` unless `commit.agent_trailer` is `false`,
   `Casefile-Change:` and `Casefile-Dashboard: <slug>`.

Nothing is written when an error is returned. To change one widget, send the
whole dashboard again with that widget changed: `save` never merges, and a
comment written by hand in the file does not survive it.

## list

Every dashboard that loads, project by project (only `--project`'s when
given), by slug: `project`, `slug`, `title`, `description`, `widgets` (how
many) and `path`. A file that does not load is not listed; `casefile validate`
says why.

## remove

1. Finds the project and the file (`dashboard.unknown` when there is none).
2. Deletes it and returns the commit of that deletion, with the same trailers
   as `save` and the summary `remove dashboard <slug>`. Stage it with
   `git add -- <path>` like a written file.

A file that does not load can still be removed.

## validate

`casefile validate` reports a dashboard file that does not match this shape
(`schema.invalid`) and, for one that does, what `save` would refuse:
`dashboard.duplicate_widget`, `dashboard.unknown_milestone`,
`dashboard.invalid_query`. Fix them by saving the dashboard again.
