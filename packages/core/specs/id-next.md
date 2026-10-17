# id-next

Prints the next free case id of a project, for the agent to name a new case
file. It never writes and reserves nothing.

- **Actor:** human, agent, CI
- **CLI:** `casefile id next [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `project` | project name | The project. Filled by the host from `--project` or the project containing `--cwd`. Required when the workspace has several projects. |

## Behaviour

1. Ids are unique **per project** (`web/TC-0003` and `api/TC-0003` can both
   exist).
2. The next id is one above the highest `TC-` number in the project, with at
   least four digits. A case file that does not parse still holds its number.
3. Nothing is reserved: two agents asking at once get the same id. Create the
   file right away; `casefile validate` reports `case.duplicate_id` otherwise.

## Output

```json
{ "project": "web", "id": "TC-0009" }
```

## Errors

| Code | When |
|---|---|
| `project.required` | no `project` and the workspace has more (or fewer) than one |
| `project.unknown` | `project` names no project |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
