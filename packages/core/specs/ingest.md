# ingest

Turns a test report into run events: each test result whose ref is a case's
`automation.ref` becomes an event in `<project>/context/tests/.runs/<run>.jsonl`.
Those events are what make a case `automated` (ADR write-ownership). CI runs it
after the tests; it never touches a case. It makes no commit: it returns the
commit of the run file, and the caller runs it (ADR ci-commits-run-files).

- **Actor:** CI, agent (`CASEFILE_ACTOR=ci` or `agent`)
- **CLI:** `casefile ingest <format> <report> --run <id> --executor ci:<name> [--tested-commit <sha>] [--env <env>] [--build <build>] [--milestone <slug>] [--project <name>] --json`
  (read `commit` from the `--json` output: the plain output does not keep the message byte for byte)
- **Formats:** `junit` (built in); extensions add more (see the last section)
- **Writes:** `**/context/tests/.runs/*.jsonl` (appends only)

Each format is its own operation, `ingest-<format>`, with the same input,
output and rules: `casefile spec ingest-<format>` shows the SPEC for one
format; built-in formats are described here.

## Input

| Field | Type | Meaning |
|---|---|---|
| `report` | path | The report file, **relative to the workspace root** (where `casefile.yaml` is), inside the workspace. |
| `run` | file-safe id | The run: names the run file. Use the CI run id (`$GITHUB_RUN_ID`), the same for every shard of one run. |
| `executor` | `ci:<name>` / `agent:<name>` | Who ran the tests. The prefix must be the actor: CI ingests as `ci:*`, an agent as `agent:*`. Humans record runs with the `run` operation. |
| `testedCommit` | commit hash, optional | The commit the tests ran on (`--tested-commit "$GITHUB_SHA"`): the `Tested-Commit:` trailer of the returned commit. Never written to the run file. CI passes it because it ingests on the branch tip, which may be newer than the tested commit (`casefile spec ci`). |
| `env`, `build` | text | Copied into every event. `build` is what gates read as `milestone.build` (`casefile spec query-grammar`). |
| `milestone` | slug, optional | An open milestone of the project (`casefile spec milestone`): every event belongs to it. `--release`, its name before `0.2.0`, still works, with a deprecation notice. |
| `project` | project name | Filled by the host from `--project` or the project containing `--cwd`. Required when the workspace has several projects and `--cwd` is in none. |
| `ticket` | text, optional | The ticket key, only for a subject template that names `{ticket}` (`casefile spec cover`, *Commit subject*): `--ticket PROJ-123`. |
| `branch` | text | Filled by the host: the checked-out branch, none on a detached HEAD. `commit.ticket_from_branch` reads the ticket from it. |

## What it does

1. Parses the report into results: `{ ref, status, at?, duration_ms?, evidence?, source?, note? }`.
2. Merges results that share a `ref` (a test run in several Playwright
   projects) into one: the **worst** status (`failed` > `blocked` > `passed` >
   `not_run` > `skipped`), the latest `at`, the longest `duration_ms`, and one
   `evidence` entry per result, `{ "kind": "result:<status>", "ref": "<source>" }`
   (`#1`, `#2`… without a source). One event per case and report keeps a
   failure in one project from being hidden by a pass in another: gates read
   the latest event per case, and these would share `at`. The merged `note` is
   the distinct notes of the results with the merged status, joined by a blank
   line.
3. Matches each `ref` against the `automation.ref` of the project's cases.
   A ref on no case is **unmatched**: listed in the output with its status,
   never written. A ref on several cases gives one event per case.
4. Builds one run event per match, checked against the run-event schema
   (`schema/run-event.schema.json`); `at` is the report's time when it has a
   time zone, else the ingestion time. A `note` longer than 2000 characters is
   cut to 2000, the last one `…` (ADR run-event-note).
5. Appends to `.runs/<run>.jsonl` the events the file does not hold yet.
   Events are compared without `at`, counting repeats: ingesting the same
   report twice writes nothing the second time, and a second shard of the
   same run adds only its own events. Existing lines are never changed.
   Shards ingested in separate CI checkouts each append to the same file and
   their commits conflict: ingest all shards from one record job
   (`casefile spec ci`). Results merge only within one report (step 2), so
   when shards can split one test's projects, ingest the merged report
   (`playwright merge-reports --reporter junit`) instead of each shard.
6. **Does not commit.** When it appended events, it returns the commit of the
   run file: `commit.author` follows the actor, `commit.message` is built by
   casefile, and `commit.files` is the run file alone. The caller commits
   exactly that file:

   ```bash
   git add <run file>
   git -c user.name=casefile-ci -c user.email=casefile-ci@casefile.invalid \
     commit -F <message file> -- <run file>
   ```

   | Actor | `commit.author` |
   |---|---|
   | `ci` | `casefile-ci <casefile-ci@casefile.invalid>` |
   | `agent` | `casefile-agent <casefile-agent@casefile.invalid>` |

   Use the name and email of `commit.author` in `-c user.name=… -c user.email=…`,
   and keep the `-- <run file>`: anything else staged stays out of the commit.
   The subject follows the workspace's template (`casefile spec cover`, *Commit
   subject*), by default `test(<project>): record run <run>`; with `{ticket}` in
   it, CI passes `--ticket` or relies on `commit.ticket_default`. The trailers are
   `Casefile-Run: <run>`, `Executor: <executor>` and, when `testedCommit` was
   given, `Tested-Commit: <sha>`. A run writes no `history` entry and answers
   no one's request, so there is no `Requested-by:` or `Casefile-Change:`.
   When nothing was appended there is no `commit`: there is nothing to
   commit. CI pushes the commit and, if the push is rejected, resets to the
   new tip and ingests again (`casefile spec ci`); step 5 makes that retry
   append only what the branch still lacks.

```json 9137.jsonl
{"run_id":"9137","case_id":"TC-0001","status":"passed","executor":"ci:github-actions","at":"2026-10-17T09:12:03Z","build":"web-2.1.0+9","duration_ms":1204,"automation_ref":"login.spec.ts::signs in with valid credentials"}
```

## Output

```json
{ "project": "web", "run": "9137",
  "path": "apps/web/context/tests/.runs/9137.jsonl",
  "results": 6, "events": 1, "appended": 1,
  "unmatched": [{ "ref": "login.spec.ts::rejects an empty password", "status": "failed" }],
  "commit": {
    "author": "casefile-ci <casefile-ci@casefile.invalid>",
    "message": "test(web): record run 9137\n\nCasefile-Run: 9137\nExecutor: ci:github-actions\nTested-Commit: 4f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c\n",
    "files": ["apps/web/context/tests/.runs/9137.jsonl"] },
  "next": ["Commit the run file with commit.author and commit.message taken from --json output, staging only it (`git commit -F <message> -- <path>`)",
           "Push it; if the push is rejected, reset to the new tip and ingest again, never resolve a conflict (`casefile spec ci`)",
           "1 result matches no case's automation.ref: …"] }
```

`events` counts the events the report gives; `appended` the ones written now.
`commit` is there only when `appended` is above 0. For an agent, `commit.author`
is `casefile-agent` and `next` does not say to push. Unmatched results are
expected for tests no case describes yet: give the case that `automation.ref`
(`casefile spec cover`) and the next run matches it. casefile reads runs only
from the repository, so a run counts once its commit is on the branch.

## JUnit (`casefile ingest junit`)

JUnit XML as written by Playwright (`reporter: [["junit", { outputFile }]]`),
Jest, Maven Surefire, pytest: a `<testsuites>` or `<testsuite>` root, nested
suites allowed. One result per `<testcase>`:

| Result | From |
|---|---|
| `ref` | `<classname>::<name>`; the nearest suite's `name` when `classname` is missing |
| `status` | `failed` with a `<failure>` or `<error>` child, `skipped` with `<skipped>`, else `passed` |
| `at` | the test case's or nearest suite's `timestamp`, when it has a time zone |
| `duration_ms` | `time` in seconds × 1000, rounded |
| `source` | Playwright only (a `<testsuites id="…">` root, which its reporter always writes): the nearest suite's `hostname`, the project (`chromium`). Other runners (vitest, pytest, Surefire) write the machine's name there, so they get no `source`: a committed run file must not publish it |
| `note` | the `<failure>` or `<error>` text (the runner's message, call log or stack trace), blank edge lines removed and dedented; without text, its `message` attribute |
| `evidence` | one `{ "kind": "attachment", "ref": "<path>" }` per `[[ATTACHMENT\|<path>]]` line in `<system-out>` (Playwright): a relative path made workspace-relative from the report's directory, an absolute one kept as written |

A failed Playwright test, reported in `results/junit.xml`:

```json 9138.jsonl
{"run_id":"9138","case_id":"TC-0002","status":"failed","executor":"ci:github-actions","at":"2026-10-17T09:12:03Z","duration_ms":611,"evidence":[{"kind":"attachment","ref":"test-results/login-rejects-an-empty-password-chromium/test-failed-1.png"}],"automation_ref":"login.spec.ts::rejects an empty password","note":"[chromium] › login.spec.ts:18:5 › rejects an empty password ───\n\n  Error: expect(locator).toHaveText(expected) failed"}
```

`casefile runs <ref>` lists a case's events with their notes.

For Playwright the ref is `<test file>::<title path>`: the file relative to
`testDir`, then the titles inside it joined by ` › `, as Playwright writes them:

| Test | `automation.ref` |
|---|---|
| `login.spec.ts`: `test("rejects an empty password")` | `login.spec.ts::rejects an empty password` |
| inside `test.describe("password reset")` | `login.spec.ts::password reset › sends a reset link` |
| Surefire `com.acme.OrderApiTest#createsAnOrder` | `com.acme.OrderApiTest::createsAnOrder` |

A test that runs in several Playwright projects (chromium, firefox) gives one
result per project and, merged, one event per case:

```json 9137-projects.jsonl
{"run_id":"9137","case_id":"TC-0001","status":"failed","executor":"ci:github-actions","at":"2026-10-17T09:12:03Z","duration_ms":2500,"evidence":[{"kind":"result:passed","ref":"chromium"},{"kind":"result:failed","ref":"firefox"}],"automation_ref":"login.spec.ts::signs in with valid credentials"}
```

A `DOCTYPE` is refused: casefile never expands entities or fetches anything a
report points to.

## Errors

| Code | When |
|---|---|
| `ingest.executor_mismatch` | the `executor` prefix is not the actor |
| `ingest.report_missing` | no file at `report` (relative to the workspace root) |
| `ingest.invalid_report` | the report does not parse (with `line` and `column`) or is not of this format |
| `ingest.invalid_result` | an ingester returned a result that is not `{ ref, status, … }` (with `field: results.<i>.<field>`) |
| `ingest.invalid_event` | a result made an event that does not match the run-event schema |
| `operation.invalid_input` | an input does not match its schema (with the field), e.g. a `testedCommit` that is not a commit hash |
| `path.outside_workspace` | `report` leaves the workspace: copy the report inside it first |
| `operation.actor_not_allowed` | the actor is `human` |
| `project.required` / `project.unknown` | as in `casefile spec cover` |
| `milestone.unknown` / `milestone.closed` | the milestone is not declared, or is closed (`casefile spec milestone`) |
| `commit.ticket_*`, `config.commit_*` | the subject template, as in `casefile spec cover` |

Nothing is written when any error occurs.

## Another format, from an extension

An extension adds a format without changes to casefile: its manifest lists
ingesters, and each one becomes the command `casefile ingest <format>` with
the input, matching, idempotency and errors above.

```js
export const manifest = {
  ingesters: [{
    format: "tap",                      // slug: casefile ingest tap <report>
    spec: "specs/ingest-tap.md",        // its SPEC, relative to the package; cite `casefile spec ingest`
    parse(text, { path }) {             // report text (UTF-8); may be async
      return { ok: true, value: [{ ref: "auth.t::rejects an empty password", status: "failed" }] };
    },
  }],
};
```

`parse` returns `{ ok: true, value: results }` or `{ ok: false, errors }`, with
errors as values (`code`, `message`, `path`, `line`, `column`); it only reads
the text it is given. Each result is `{ ref, status, at?, duration_ms?,
evidence?, source?, note? }`, checked by casefile before any event is built; set
`source` when one test can report several times, so merged results stay
traceable, and `note` to say why a test failed (any length: casefile bounds
it). The extension
must say, in its SPEC, how its refs are formed so that `automation.ref` can be
written to match. A format that is already registered (`junit`) is refused as
`operation.duplicate`.
