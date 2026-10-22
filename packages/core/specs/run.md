# run

Records the result of one case that a person or an agent executed: one run
event appended to `<project>/context/tests/.runs/<run>.jsonl`. The QA calls it
after running a case by hand; the viewer calls it when the QA records a result
on the case page (ADR human-writes-through-operations). casefile does not run
anything: it writes down what the executor says happened, and returns the
commit to make.

- **Actor:** human, agent
- **CLI:** `casefile run <ref> --status <passed|failed|blocked|skipped> [--note <text>] [--env <env>] [--build <build>] [--release <release>] [--run <id>] [--agent <name>] [--project <name>] --json`
  (an agent runs it with `CASEFILE_ACTOR=agent`; read `commit` from the `--json` output)
- **Writes:** `**/context/tests/.runs/*.jsonl` (appends only)

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
| `env`, `build`, `release` | text, optional | Where it ran and what was tested. `build` and `release` are what release gates read (`casefile spec query-grammar`). |
| `run` | file-safe id, optional | The run: names the run file. Default `manual-<date>`, today's UTC date, so a day of manual results shares one file. Pass a test cycle's id (`rc-2.1`) to group them under it. |
| `agent` | text | The agent recording it (`claude-code`): the executor is `agent:<agent>`. Required for an agent, refused for a human. |
| `identity` | email | Filled by the host from `git config user.email` in the workspace: a human's executor is `human:<identity>`. |
| `project` | project name | Filled by the host from `--project` or the project containing `--cwd`. |

`identity` is a host input, never a flag (ADR cli-generic-host). There is no
`automation_ref` input: an event recorded here never carries one, so it can
never make a case `automated`.

## Behaviour

1. Finds the case (`case.unknown`, `case.ambiguous`).
2. Builds the event, checked against the run-event schema
   (`schema/run-event.schema.json`), keys in schema order:
   `{ run_id, case_id, status, executor, at: <now, UTC>, env?, build?, release?, note? }`.
3. Reads `.runs/<run>.jsonl` in the case's project. If the last event of this
   case in that file equals the new one apart from `at`, writes nothing: the
   call is a retry of one already recorded. Otherwise appends the event as one
   line; existing lines are never changed.
4. **Does not commit.** It returns the commit to make, of that one file. Its
   trailers are a run's, as CI's (ADR ci-commits-run-files): `Casefile-Run:`
   and `Executor:`; a run answers no one's request, so there is no
   `Requested-by:` and no `Casefile-Change:`.
   - **agent:** `commit.author` is `casefile-agent <casefile-agent@casefile.invalid>`.
     Commit it as `casefile spec cover` says
     (`git -c user.name=… -c user.email=… commit -F <message> -- <path>`).
   - **human:** there is no `commit.author`; the commit is made with the
     human's own Git identity (`git commit -F <message> -- <path>`). From the
     CLI, the human runs it; the viewer runs it for them.

   The subject is `run(<feature>): record <id> as <status>`. When nothing was
   appended there is no `commit`.

**Postconditions:** `casefile runs <ref>` lists the event first (newest
first). `casefile validate` reports nothing new for the run file.

**Idempotency:** a retry of the same call (same case, run, status, note,
env, build, release and executor) writes nothing while that result is still
the case's last in the run file: commit the file of the first call instead.
Executing the case again and recording a result always appends, even one
equal to an earlier result: passed, then failed, then passed records three
events, and the last result is `passed`. (`ingest`'s rule, which drops any
event already in the file, would drop that second pass and leave `failed` as
the last result.)

## Output

```json
{ "ref": "web/TC-0002",
  "run": "manual-2026-10-21",
  "path": "apps/web/context/tests/.runs/manual-2026-10-21.jsonl",
  "appended": true,
  "event": { "run_id": "manual-2026-10-21", "case_id": "TC-0002", "status": "failed", "…": "…" },
  "commit": {
    "message": "run(login): record TC-0002 as failed\n\nCasefile-Run: manual-2026-10-21\nExecutor: human:qa@acme.example\n" },
  "next": ["Commit the run file with commit.message taken from --json output, as yourself, staging only it (`git commit -F <message> -- <path>`)"] }
```

For an agent, `commit` also has `author`. When `appended` is `false`, there is
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

## Errors

Nothing is written when any of these is returned.

| Code | When |
|---|---|
| `operation.invalid_input` | the input does not match its schema (with the field path), e.g. `--status not_run` or an `automation_ref` |
| `run.agent_required` / `run.agent_not_allowed` | `agent` missing for an agent, or given by a human |
| `identity.missing` | a human, and the host found no `git config user.email` in the workspace |
| `case.unknown` / `case.ambiguous` | no such case, or a bare id found in several projects |
| `project.unknown` | `project` names no project |
| `operation.actor_not_allowed` | invoked by CI: CI records results with `casefile ingest` |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
