# init

Creates the files a casefile workspace starts from. Run once by the human,
before `/casefile-setup`; running it again is safe.

- **Actor:** human. An agent may type it for the human when they asked for
  the install and confirmed the version and the skills directory, and then
  without `CASEFILE_ACTOR=agent` (ADR agent-runs-init-on-request; the
  repository's `QUICKSTART.md` is that procedure)
- **CLI:** `casefile init [--skills-into <dir>]…`; without `--skills-into` it only
  lists the skills and the command that copies them (no prompt)
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
   - `.casefile/package.json`: `dependencies["@casefile/cli"]` and
     `dependencies["@casefile/web"]` (the viewer `casefile ui` runs) pinned to
     `casefileVersion` (exact, no range).
   - `.casefile/.gitignore`: `node_modules/`.
2. Copies every skill file into each directory in `skillsInto`, at
   `<target>/<path>`, with the same never-overwrite rule. With `skillsInto`
   empty, nothing is copied: the skill names come back in `skillsOffered` so the
   host can offer them (the CLI prints the `--skills-into` command in `next`). Skills are never installed silently.
   When `skillsInto` is empty but `.claude/skills` or `.agents/skills` already
   holds casefile's skills (an upgraded workspace), `skillsOffered` lists only
   the skills this version adds there.
3. Compares each kept skill with the shipped one, in the chosen targets or the
   ones that already hold casefile's skills: a skill with a shipped file whose
   text differs is `stale` (`<target>/<name>`), from an older version or edited
   by hand. Files only the workspace has do not count. A stale skill is still
   never overwritten; `next` gives the command that replaces it on purpose
   (`rm -rf <target>/<name> && casefile init --skills-into <target>`), to run
   only for skills nobody edited.
4. Never writes under `context/` (the agent owns it) and never creates or edits
   the product's own `package.json`.
5. Installs nothing. The setup skill runs
   `npm install --prefix .casefile --ignore-scripts` afterwards. Without the
   npm registry, the release's toolchain tarball is unpacked into `.casefile/`
   first and `init` runs from it (`casefile spec setup`); `init` keeps what is
   already there.
6. Runs where the workspace is: inside an existing workspace (a `casefile.yaml`
   at or above `--cwd`) it acts at that workspace's root, so running it again
   from a subdirectory never nests a second workspace; elsewhere it creates one
   in `--cwd`.

## Output

```json
{ "created": ["casefile.yaml", ".casefile/package.json", ".casefile/.gitignore"],
  "kept": [],
  "skillsOffered": ["casefile-setup", "qa-bootstrap"],
  "stale": [],
  "next": ["Copy the shipped skills (…): casefile init --skills-into .claude/skills …",
           "Run /casefile-setup in your agent: …",
           "Sign your commits with SSH …: git config gpg.format ssh && …"] }
```

`created` lists the files this run wrote and `kept` the ones it left alone, in
that order. A second run returns `created: []`. `next` is advice for the human,
printed last by the CLI, in this order:

1. Copying the offered skills, when some are offered.
2. Replacing the stale skills, when some are stale.
3. The skill to run next, from the workspace as it is: `/casefile-setup` while
   `casefile.yaml` lists no projects; `/qa-bootstrap <project>` for each
   project without cases; otherwise `/qa-review` and `/qa-cover`. When
   `casefile.yaml` does not load, `casefile validate` instead.
4. SSH commit signing.

## Errors

| Code | When |
|---|---|
| `operation.invalid_input` | `casefileVersion` is not exact semver, an unknown `skillsInto` target, a skill `path` that is absolute or has `.`/`..` segments |
| `operation.actor_not_allowed` | invoked by an agent or CI |

## Next

`/casefile-setup` in the agent: it reads `casefile spec setup` and registers
projects with `casefile spec project-add`.
