# run

Records the result of one case that a person or an agent executed: one run
event appended to `<project>/context/tests/.runs/<run>.jsonl`. The QA calls it
after running a case by hand; the viewer calls it when the QA records a result
on the case page (ADR human-writes-through-operations). casefile does not run
anything: it writes down what the executor says happened, and returns the
commit to make.

- **Actor:** human, agent
- **CLI:** `casefile run <ref> --status <passed|failed|blocked|skipped> [--note <text>] [--evidence <path>]… [--link <url>]… [--attach <json>] [--env <env>] [--build <build>] [--milestone <slug>] [--run <id>] [--agent <name>] [--project <name>] --json`
  (an agent runs it with `CASEFILE_ACTOR=agent`; read `commit` from the `--json` output)
- **Writes:** `**/context/tests/.runs/*.jsonl` (appends only) and
  `**/context/tests/.runs/*/*/*` (evidence files, never overwritten)

Results of automated tests do not come through here: CI ingests the test
report (`casefile spec ingest`), and only those events make a case
`automated` (ADR write-ownership).

## Before calling it

1. Read the case as it is now: `casefile resolve <ref>`. Execute its steps as
   written; a step that cannot be done is `blocked`, not `failed`.
2. An agent records a result only for a case it executed itself in this
   session, or one the human reported to it ("TC-0002 failed on staging").

## Input

| Field | Type | Meaning |
|---|---|---|
| `ref` | `TC-NNNN` or `<project>/TC-NNNN` | The case, looked up like `casefile resolve`. |
| `status` | `passed`, `failed`, `blocked`, `skipped` | The result. |
| `note` | text, optional | What the executor saw: why it failed, what blocked it. Cut to 2000 characters, the last one `…` (ADR run-event-note). |
| `evidence` | file paths, optional | Files to attach (screenshot, short video, log, HAR, PDF): `--evidence <path>`, repeatable. Copied into the repository (*Evidence*). |
| `link` | URLs, optional | Links to attach (an issue, a recording, a CI build): `--link <url>`, repeatable, `http:` or `https:` only, never fetched. |
| `attach` | JSON, optional | The same with a label, for the viewer and agents: `[{ "file": "<path>", "label"?: "…" } \| { "url": "<url>", "label"?: "…" }]`; a label is 1–120 characters. |
| `env`, `build` | text, optional | Where it ran and what was tested. `build` is what gates read as `milestone.build` (`casefile spec query-grammar`). |
| `milestone` | slug, optional | An open milestone of the project (`casefile spec milestone`): the execution belongs to it. `--release`, its name before `0.2.0`, still works, with a deprecation notice. |
| `run` | file-safe id, optional | The run: names the run file. Default `manual-<date>`, today's UTC date, so a day of manual results shares one file. Pass a test cycle's id (`rc-2.1`) to group them under it. |
| `agent` | text | The agent recording it (`claude-code`): the executor is `agent:<agent>`. Required for an agent, refused for a human. |
| `identity` | email | Filled by the host: `CASEFILE_USER_EMAIL` when set, else `git config user.email` in the workspace (ADR identity-override; `casefile whoami` shows it): a human's executor is `human:<identity>`. |
| `author` | `Name <email>` | Filled by the host only when that identity is not git's own (`CASEFILE_USER_EMAIL`; the name is `CASEFILE_USER_NAME`, else the email): a human's `commit.author` (ADR identity-override §4). Unset with git's identity; ignored for an agent. |
| `project` | project name | Filled by the host from `--project` or the project containing `--cwd`. |
| `ticket` | text, optional | The ticket key, only for a subject template that names `{ticket}` (`casefile spec cover`, *Commit subject*): `--ticket PROJ-123`. |
| `branch` | text | Filled by the host: the checked-out branch, none on a detached HEAD. `commit.ticket_from_branch` reads the ticket from it. |
| `cwd` | directory | Filled by the host: the directory the user invoked it from (the CLI: the shell's, not `--cwd`). A relative `file` path resolves against it, else against the workspace root. The viewer leaves it unset. |

`identity`, `author` and `cwd` are host inputs, never flags (ADR cli-generic-host). There is no
`automation_ref` input: an event recorded here never carries one, so it can
never make a case `automated`.

## Behaviour

1. Finds the case (`case.unknown`, `case.ambiguous`).
2. Checks and reads the evidence (*Evidence*) before anything is written.
3. Builds the event, checked against the run-event schema
   (`schema/run-event.schema.json`), keys in schema order:
   `{ run_id, case_id, status, executor, at: <now, UTC>, env?, build?, milestone?, evidence?, note? }`.
4. Reads `.runs/<run>.jsonl` in the case's project. If the last event of this
   case in that file equals the new one apart from `at`, writes nothing: the
   call is a retry of one already recorded. Otherwise writes the evidence
   files not there yet, then appends the event as one line; existing lines
   are never changed.
5. **Does not commit.** It returns the commit to make: the run file, then the
   evidence files the event names. Its
   trailers are a run's, as CI's (ADR ci-commits-run-files): `Casefile-Run:`
   and `Executor:`; a run answers no one's request, so there is no
   `Requested-by:` and no `Casefile-Change:`.
   - **agent:** `commit.author` is `casefile-agent <casefile-agent@casefile.invalid>`.
     Commit it as `casefile spec cover` says
     (from the workspace root, `git add -- <files>`, then
     `git -c user.name=… -c user.email=… commit -F <message> -- <files>`).
   - **human:** with git's own identity there is no `commit.author` and the
     commit is made as the human (from the workspace root, `git add -- <files>`,
     then `git commit -F <message> -- <files>`). When casefile resolved
     another identity (`CASEFILE_USER_EMAIL`), `commit.author` is that one and
     the commit is made as it, with `git -c user.name=… -c user.email=…`, so
     its author is the executor (ADR identity-override §4). From the
     CLI, the human runs it; the viewer runs it for them. `commit.files` is
     the run file and the event's evidence files, workspace-relative: the
     pathspec to stage and commit, and nothing else.

   The subject follows the workspace's template (`casefile spec cover`, *Commit
   subject*), by default `test(<feature>): record <id> as <status>`. When nothing was
   appended there is no `commit`.

**Postconditions:** `casefile runs <ref>` lists the event first (newest
first). `casefile validate` reports nothing new for the run file.

**Idempotency:** a retry of the same call (same case, run, status, note,
env, build, milestone, evidence and executor) writes nothing while that result is still
the case's last in the run file: commit the files of the first call instead.
There is no `commit` then; `next` names the run file and the event's stored
evidence files that are there, the pathspec to commit if the first call's
commit failed.
Executing the case again and recording a result always appends, even one
equal to an earlier result: passed, then failed, then passed records three
events, and the last result is `passed`. (`ingest`'s rule, which drops any
event already in the file, would drop that second pass and leave `failed` as
the last result.)

## Evidence

ADR run-evidence-files. The event's `evidence` lists the entries in input
order: `evidence`, then `link`, then `attach`.

- **A file** is read from its path, hashed (SHA-256) and copied to
  `<project>/context/tests/.runs/<run>/<case-id>/<sha8>-<name>`: `sha8` is the
  first 8 hex digits of the hash, `name` the original base name lower-cased,
  every character outside `[a-z0-9._-]` a `-`, at most 60 characters with the
  extension kept (an empty stem becomes `file`). The entry is
  `{ "kind": "image" | "video" | "file", "ref": "<that path>", "sha256": "…", "label"?: "…" }`:
  `image` for png, jpg, jpeg, gif, webp; `video` for mp4, webm; `file` for the
  rest. The same content under the same name is written once, and both
  entries name it. A stored file is never overwritten.
- **A link** is `{ "kind": "link", "ref": "<url>", "label"?: "…" }`.
- **Limits**, from `casefile.yaml`, checked for every entry before anything is
  written:

  ```yaml
  evidence:
    max_file_mb: 10                 # per file (default 10)
    extensions: [png, jpg, pdf]     # replaces the default list
  ```

  The default list is `png jpg jpeg gif webp mp4 webm pdf txt log json har`.
  `svg htm html xhtml xml js mjs` are refused even when listed (a browser runs
  them; `casefile validate` reports them as `config.evidence_extension`). An
  event carries at most 20 entries. A long video goes as a link.
- Adding evidence later means recording the result again: run files are
  append-only. `casefile validate` reports a stored file that is missing
  (`evidence.missing`) or edited (`evidence.changed`).

## Output

```json
{ "ref": "web/TC-0002",
  "run": "manual-2026-10-21",
  "path": "apps/web/context/tests/.runs/manual-2026-10-21.jsonl",
  "appended": true,
  "event": { "run_id": "manual-2026-10-21", "case_id": "TC-0002", "status": "failed", "…": "…" },
  "commit": {
    "message": "test(login): record TC-0002 as failed\n\nCasefile-Run: manual-2026-10-21\nExecutor: human:qa@acme.example\n",
    "files": ["apps/web/context/tests/.runs/manual-2026-10-21.jsonl"] },
  "next": ["Commit the run file as yourself, with commit.message from --json output saved to a file <message>, staging only it, from the workspace root: `git add -- apps/web/context/tests/.runs/manual-2026-10-21.jsonl` then `git commit -F <message> -- apps/web/context/tests/.runs/manual-2026-10-21.jsonl`"] }
```

For an agent, `commit` also has `author`; for a human, only when
`CASEFILE_USER_EMAIL` overrides git's identity. When `appended` is `false`, there is
no `commit` and `next` says the result was already recorded.

## Example

Workspace `examples/demo-monorepo`. The QA ran `web/TC-0002` ("Reject a wrong
password") by hand on staging and it failed; the checkout's
`git config user.email` is `qa@acme.example`.

```bash
casefile run web/TC-0002 --status failed --env staging --json \
  --note "The banner says Something went wrong instead of Wrong password"
```

On 2026-10-21 it appends this line to
`apps/web/context/tests/.runs/manual-2026-10-21.jsonl`:

```json manual-2026-10-21.jsonl
{"run_id":"manual-2026-10-21","case_id":"TC-0002","status":"failed","executor":"human:qa@acme.example","at":"2026-10-21T15:04:05Z","env":"staging","note":"The banner says Something went wrong instead of Wrong password"}
```

and returns the commit of the output above.

The same failure with a screenshot from the shell's directory, the bug
filed for it and a labelled recording:

```bash
casefile run web/TC-0002 --status failed --env staging --json \
  --evidence wrong-password.png --link https://acme.example/issues/812 \
  --attach '[{"url":"https://acme.example/rec/77","label":"Screen recording"}]'
```

The event carries

```json
"evidence":[{"kind":"image","ref":"apps/web/context/tests/.runs/manual-2026-10-21/TC-0002/3f9a1c2e-wrong-password.png","sha256":"3f9a1c2e…"},{"kind":"link","ref":"https://acme.example/issues/812"},{"kind":"link","ref":"https://acme.example/rec/77","label":"Screen recording"}]
```

and `commit.files` is the run file and that `.png`. An agent attaches its own
screenshot with a label the same way:
`--attach '[{"file":"/tmp/shot.png","label":"After submitting"}]'`.

## Errors

Nothing is written when any of these is returned.

| Code | When |
|---|---|
| `operation.invalid_input` | the input does not match its schema (with the field path), e.g. `--status not_run` or an `automation_ref` |
| `run.agent_required` / `run.agent_not_allowed` | `agent` missing for an agent, or given by a human |
| `identity.missing` | a human, and the host found neither `CASEFILE_USER_EMAIL` nor `git config user.email` |
| `identity.invalid` | `CASEFILE_USER_EMAIL` or `git config user.email` is not an email (the message names which); nothing runs |
| `case.unknown` / `case.ambiguous` | no such case, or a bare id found in several projects |
| `project.unknown` | `project` names no project |
| `operation.actor_not_allowed` | invoked by CI: CI records results with `casefile ingest` |
| `commit.ticket_missing` | the subject template names `{ticket}`, and none was given, found in the branch or set as `commit.ticket_default` |
| `commit.ticket_invalid` / `commit.ticket_unused` | the ticket is not one token (letters, digits, `._#/-`), or the template names no `{ticket}` |
| `config.commit_subject` / `config.commit_ticket_regex` | `commit.subject` or `commit.ticket_from_branch` in `casefile.yaml` is broken; `casefile validate` reports it too |
| `milestone.unknown` / `milestone.closed` | the milestone is not declared, or is closed (`casefile spec milestone`) |
| `evidence.not_found` | a file to attach is not there, or is not a regular file (a directory, device); the message names the path it looked for |
| `evidence.type` | a file's extension is not allowed in this workspace, or is a script type |
| `evidence.too_large` | a file is over `evidence.max_file_mb` (default 10 MB), from its size: it is never read |
| `evidence.too_many` | more than 20 entries in `evidence`, `link` and `attach` together |
| `evidence.link` | a link is not an `http:` or `https:` URL |
| `evidence.conflict` | the stored path exists with other content (edited after it was recorded); `casefile validate` says `evidence.changed` |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |

An `evidence.*` error names its entry as `field`: `evidence.0`, `link.1`,
`attach.2` (for `evidence.too_many`, the first entry over the limit).
