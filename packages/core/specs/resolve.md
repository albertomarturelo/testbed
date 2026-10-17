# resolve

Shows one case as casefile sees it after inheritance: every inherited value
next to the file it came from. It never writes.

- **Actor:** human, agent, CI
- **CLI:** `casefile resolve <ref> [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `ref` | `TC-NNNN` or `<project>/TC-NNNN` | The case. A qualified ref names its project; a bare id is looked up in `project`, else in every project. |
| `project` | project name | Filled by the host from `--project` or the project containing `--cwd`. |

## Behaviour

1. Loads and resolves the workspace: extension commons → workspace `commons` →
   project `_common.yaml` → ancestors → case. Commit ids in `history` are
   `null` until the git adapter lands (#10).
2. A bare id found in **several** projects is `case.ambiguous`: ids are unique
   per project, so qualify it (`web/TC-0001`) or pass `--project`.

## Output

```json
{ "ref": "web/TC-0003", "path": "context/tests/checkout/payments/TC-0003.md",
  "inherited": [{ "field": "priority", "value": "P1",
                  "origin": "context/tests/checkout/payments/_common.yaml" }],
  "case": { "id": "TC-0003", "project": "web", "...": "the resolved case" } }
```

`inherited` has one row per inheritable value (`surfaces`, `layer`, `priority`,
`automation.eligible`, `labels.<key>`, `data.<key>`, `preconditions.<n>`); a
value written in the case itself has origin `(the case)`. Lists and objects are
shown as JSON text in `value`; `case` keeps them typed.

## Errors

| Code | When |
|---|---|
| `case.unknown` | no case with that id in the scope |
| `case.ambiguous` | a bare id matches cases in several projects |
| `project.unknown` | the qualifier or `project` names no project |
| `resolve.missing_field` | the case does not resolve (a required field is set nowhere) |
| `operation.invalid_input` | `ref` is not `TC-NNNN` or `<project>/TC-NNNN` |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
