# init

Creates the files a casefile workspace starts from. Run once by the human,
before `/casefile-setup`; running it again is safe.

- **Actor:** human
- **CLI:** `casefile init`; the CLI asks which skill directories to fill
- **Writes:** `casefile.yaml`, `.casefile/package.json`, `.casefile/.gitignore`,
  `.claude/skills/**`, `.agents/skills/**`

## Input

| Field | Type | Meaning |
|---|---|---|
| `casefileVersion` | exact semver | The casefile running `init`; filled by the host. |
| `skills` | `{ path, text }[]` | The skills shipped in the casefile package; filled by the host. |
| `skillsInto` | (`.claude/skills` \| `.agents/skills`)[] | Where to copy them. Default `[]`: offer only. |

## Behaviour

1. Writes each file below **only if it does not exist**. An existing file is
   never changed, even if it differs.
   - `casefile.yaml`: `version: 1`, `projects: []` and a comment pointing to
     `casefile spec setup`.
   - `.casefile/package.json`: `dependencies.casefile` pinned to
     `casefileVersion` (exact, no range).
   - `.casefile/.gitignore`: `node_modules/`.
2. Copies every skill file into each directory in `skillsInto`, at
   `<target>/<path>`, with the same never-overwrite rule. With `skillsInto`
   empty, nothing is copied: the skill names come back in `skillsOffered` so the
   host can ask the human. Skills are never installed silently.
3. Never writes under `context/` (the agent owns it) and never creates or edits
   the product's own `package.json`.
4. Installs nothing. The setup skill runs
   `npm install --prefix .casefile --ignore-scripts` afterwards.

## Output

```json
{ "created": ["casefile.yaml", ".casefile/package.json", ".casefile/.gitignore"],
  "kept": [],
  "skillsOffered": ["casefile-setup", "qa-bootstrap"] }
```

`created` lists the files this run wrote and `kept` the ones it left alone, in
that order. A second run returns `created: []`.

## Errors

| Code | When |
|---|---|
| `operation.invalid_input` | `casefileVersion` is not exact semver, an unknown `skillsInto` target, a skill `path` that is absolute or has `.`/`..` segments |
| `operation.actor_not_allowed` | invoked by an agent or CI |

## Next

`/casefile-setup` in the agent: it reads `casefile spec setup` and registers
projects with `casefile spec project-add`.
