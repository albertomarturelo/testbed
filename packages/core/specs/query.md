# query

Lists the cases a query selects. The same language filters cases in the UI,
defines collections and scopes release gates. It never writes.

- **Actor:** human, agent, CI
- **CLI:** `casefile query "<query>" [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `query` | DSL text | Evaluated on each **resolved** case. Full grammar and semantics: `casefile spec query-grammar`. |
| `project` | project name | Only that project's cases. Filled by the host from `--project` or the project containing `--cwd`; absent: every project. |

## The language, briefly

`AND`, `OR`, `NOT`, parentheses; `= != < <= > >=`; `IN (a, b)`; `CONTAINS`;
dotted paths into the resolved case (`labels.risk`, `automation.status`,
`project`). Bare words are values (`state = active`); quote a value with spaces
(`title CONTAINS "saved card"`). A missing field or a type mismatch matches
nothing, it is never an error.

```
labels.risk = payments AND automation.status != automated
priority <= P1 AND NOT state IN (retired, draft)
surfaces CONTAINS ios OR project = api
```

Context variables (`release.name`, `release.build`) only have values inside a
gate (#47); here they are `query.unknown_variable`.

## Output

```json
{ "count": 2,
  "cases": [{ "ref": "web/TC-0003", "state": "active", "priority": "P1",
              "title": "Pay with a saved card" }],
  "unresolved": 0 }
```

Cases come in project order, then path order. `unresolved` counts cases that
do not resolve (a required field is set nowhere): they cannot match, and
`casefile validate` says why.

## Errors

DSL errors carry `column` (1-based in the query) and `field: "query"`; the CLI
prints the query with a caret under the column.

| Code | When |
|---|---|
| `query.unexpected_token` / `query.unexpected_end` | the query does not parse |
| `query.unterminated_string` / `query.invalid_character` | a quote is never closed; a `!` without `=` |
| `query.too_deep` | `NOT` / `(` nested more than 64 levels |
| `query.unknown_variable` | a `release.*` variable outside a gate |
| `project.unknown` | `project` names no project |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
