# project-add

Registers a project in `casefile.yaml` and scaffolds its `context/tests/`.
The agent runs it once per project during setup, after the human has confirmed
the plan.

- **Actor:** agent
- **CLI:** `casefile project add <name> --path <path>` (run with `CASEFILE_ACTOR=agent`)
- **Writes:** `casefile.yaml`, `**/context/tests/_common.yaml`,
  `**/context/tests/.runs/.gitkeep`, `**/context/tests/.inbox/.gitkeep`

## Input

| Field | Type | Meaning |
|---|---|---|
| `name` | slug (`^[a-z][a-z0-9-]*$`) | Unique in the workspace; qualifies ids (`web/TC-0003`). |
| `path` | POSIX path | The project directory, relative to `casefile.yaml`; `.` for a single-project repo. Stored normalized (`apps/web/` → `apps/web`). |

## Behaviour

1. Needs `casefile.yaml` (written by `init`) with `version: 1` and a
   `projects` list. The rest of the file is not checked here.
2. Appends `{ name, path }` to `projects`, keeping the file's comments, key
   order and formatting.
3. Creates, **only if absent**:
   - `<path>/context/tests/_common.yaml`: every field set to the marker `TODO`,
     with a comment listing its allowed values. The fields are `surfaces`,
     `layer`, `priority`, `automation.eligible` and `review.mode`.
   - `<path>/context/tests/.runs/.gitkeep` and `.inbox/.gitkeep`, so Git keeps
     the empty directories.
4. **Same arguments again is a no-op** (`created: []`). If the project is
   registered but a scaffold file is missing, only that file is written. An
   existing file is never overwritten.

## After it: replace every TODO

Each `TODO` is a decision for you to make from what you learned about the
project. Replace it with one of the values in its comment (`surfaces` takes a
list), or delete the key to inherit from the workspace `commons`. Then loop on
`casefile validate --json`: every marker left is reported as `scaffold.todo`.

## Output

```json
{ "name": "web", "path": "apps/web",
  "created": ["casefile.yaml", "apps/web/context/tests/_common.yaml",
              "apps/web/context/tests/.runs/.gitkeep", "apps/web/context/tests/.inbox/.gitkeep"] }
```

## Errors

Nothing is written when any of these is returned.

| Code | When |
|---|---|
| `config.missing` | no `casefile.yaml`; the human runs `casefile init` first |
| `yaml.invalid` / `schema.invalid` | `casefile.yaml` is unreadable, or `version`/`projects` is malformed |
| `project.outside_workspace` | `path` is absolute or leaves the workspace |
| `project.missing` | `path` does not exist in the workspace |
| `project.name_taken` | `name` is registered with a different path |
| `project.path_taken` | `path` is registered under a different name |
| `project.nested` | `path` is inside another project, or contains one (projects do not nest) |
| `operation.invalid_input` | `name` is not a slug |
| `operation.actor_not_allowed` | invoked by a human or CI |
