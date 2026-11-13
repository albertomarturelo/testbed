# Dashboards are files the agent writes and the viewer renders

## Status

Accepted — 2026-11-13 (#184). Adds a row to
[write-ownership](2026-10-15-write-ownership.md)'s table
(`context/dashboards/*.yaml`: agent or human, through `dashboard save` /
`dashboard remove`). Adds Recharts to the bundled client libraries of
[local-ui-stack](2026-10-17-local-ui-stack.md) §5. The query grammar
([single-query-dsl](2026-10-15-single-query-dsl.md)) is unchanged.

## Context

The viewer shows lists, a case page and milestones, but nothing aggregates:
"how many cases per feature have no test", "what failed in this release" are
questions the QA answers by counting rows. The maintainer wants dashboards
described as declarative JSON, the way Datadog's are, so a model can build
them on request, and kept, so the QA never rebuilds one. The maintainer chose
(2026-11-13): shadcn Charts for rendering, one YAML file per dashboard, and a
first version where the agent creates and the viewer only shows.

## Decision

1. **A dashboard is a file** per project, `context/dashboards/<slug>.yaml`:
   `title`, `description?`, `widgets` (1–24, in reading order). Git keeps it
   and its history; every clone has the same dashboards.
2. **A widget** has `id` (unique in the dashboard), `title`, `type`, `query?`
   (the existing DSL over resolved cases; absent = every case), `milestone?`
   (a declared slug: results are read inside it and `milestone.*` is defined
   for the query), `width?` (columns of 12; a default per type) and, by type:
   - `stat`: the number of matching cases.
   - `bar`, `donut`: matching cases counted per value of `group_by`, a dotted
     path on the resolved case (`state`, `priority`, `feature`,
     `automation.status`, `labels.risk`) or the derived `last_result` (the
     case's latest execution, `not_run` when none). No value → `(none)`.
   - `table`: matching cases with `columns` (paths) and a `limit`.
   - `timeseries`: executions of the matching cases per day, by status, over
     `days` (default 30) or the milestone's span.
   The only measure is a count. Formulas, percentages and other aggregations
   wait for a real need.
3. **Layout is flow, not coordinates:** widgets fill a 12-column grid in array
   order by `width` and stack on a narrow screen. No `x`/`y`/`height`.
4. **Operations** (actors agent and human): `dashboard save <slug>` takes the
   whole dashboard as JSON (`spec`), checks it (schema, every query parses,
   milestones exist, ids unique) and writes the file whole, all or nothing;
   `dashboard remove <slug>` deletes it. Both return the commit (ADR
   agent-runs-the-commit) with `Casefile-Dashboard: <slug>`. Read-only:
   `dashboard list`, `dashboard show <slug>`.
5. **Core computes the data.** `dashboard show` returns each widget with its
   `data`, or an `error` for that widget alone. The viewer draws what it
   gets; the CLI and the agent read the same numbers with `--json`. No host
   aggregates (ADR apps-vs-packages).
6. **Viewer:** `#/dashboards` and `#/dashboard/<project>/<slug>`, read-only.
   Charts use shadcn's `chart` component over **Recharts**, a bundled dev
   dependency at an exact version with its STACK row when it lands; `stat`
   and `table` need no chart library. Every chart's values are readable
   without hover.
7. **Validate:** a malformed dashboard file is `schema.invalid`; a widget
   whose query does not parse or that names an undeclared milestone is a
   finding on that file.
8. **For the agent:** SPEC `dashboard` (the widget catalogue with one example
   per type) and the skill `qa-dashboard`: propose the widgets in words, ask
   once, one committed `save`, check with `show`, never edit the file by hand.

## Alternatives Considered

1. **The model writes Vega-Lite specs** — already a JSON chart grammar and
   very flexible, but heavy to bundle, it selects data with its own
   transforms instead of the one DSL, and the result ignores the viewer's
   design system.
2. **A `.json` file on disk, literally like Datadog** — what the model sends
   is what is stored, but it would be the only JSON under `context/`, with
   noisier diffs and no comments. The operation takes JSON either way.
3. **Dashboards in the browser (localStorage)** — no file format, but they
   vanish with the profile and nobody else sees them: not persisted.
4. **A widget editor in the viewer now** — drag, resize and query forms are
   weeks of UI for something the QA can ask for in one sentence. Later, over
   the same `save`.
5. **Fixed built-in dashboards only** — no format to design, but every team
   asks different questions; that is why the agent builds them.
6. **Free `x`/`y`/`w`/`h` placement like Datadog** — models place boxes
   badly, and two edits of one dashboard conflict on every coordinate.
7. **Export to Grafana or Datadog** — needs a metrics store and a vendor;
   files stay the source of truth. A bridge can mirror later.
8. **The client aggregates raw cases and runs** — a second implementation of
   "latest result per case" outside core, invisible to the CLI and the agent.

## Consequences

- Issues, one session each, in order: #185 core (schema, `save`, `list`,
  `remove`, validate, SPEC); #186 data (`show`); #187 viewer (Recharts);
  #188 skill `qa-dashboard` (`init` then copies five skills).
- A dashboard is computed on every open, from files, like every view until
  the #26 index; a slow workspace shows it here first.
- The widget catalogue is a public format: a new type or field is additive,
  renaming one is breaking and needs a release note.
- `group_by` takes a path, not an expression; `last_result` is the one
  derived name. Anything richer is a grammar decision with its own ADR.
- `save` replaces the file whole, so YAML comments in a dashboard are lost
  on the next save.
