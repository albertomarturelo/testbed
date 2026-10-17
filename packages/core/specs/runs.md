# runs

Lists one case's run events, newest first: status, time, run, executor,
evidence and the note that says why the run ended as it did. The local UI's
case detail shows them. It never writes.

- **Actor:** human, agent, CI
- **CLI:** `casefile runs <ref> [--project <name>] [--json]`
- **Writes:** nothing

## Input

| Field | Type | Meaning |
|---|---|---|
| `ref` | `TC-NNNN` or `<project>/TC-NNNN` | The case. A qualified ref names its project; a bare id is looked up in `project`, else in every project. |
| `project` | project name | Filled by the host from `--project` or the project containing `--cwd`. |

## Behaviour

1. Finds the case as `casefile spec resolve` does; a bare id in several
   projects is `case.ambiguous`. The case does not have to resolve: a case
   with a missing field still lists its runs.
2. Reads every `.runs/*.jsonl` of the case's project and keeps the events whose
   `case_id` is the case's id. Lines that are not valid run events are left out;
   `casefile validate` reports them.
3. Sorts them by `at`, newest first. On a tie the later line comes first (a later
   file, then a later line in it), the same event `overview` shows as
   `last_run`.

## Output

```json
{ "ref": "npm-login/TC-0003",
  "runs": [{ "run_id": "local-2026-10-17-1", "case_id": "TC-0003", "status": "failed",
             "executor": "agent:claude-code", "at": "2026-10-17T19:23:06Z",
             "duration_ms": 5509,
             "evidence": [{ "kind": "attachment",
                            "ref": "test-results/login-masks-the-password-chromium/error-context.md" }],
             "automation_ref": "login.spec.ts::masks the password and shows it on request",
             "note": "[chromium] › login.spec.ts:27:5 › masks the password …\n\n  Error: expect(locator).toHaveAttribute(expected) failed",
             "path": "context/tests/.runs/local-2026-10-17-1.jsonl" }] }
```

Each item is the run event as written (`casefile spec ingest`, schema
`schema/run-event.schema.json`) plus `path`, the workspace-relative run file it
is a line of. `note` is at most 2000 characters: ingest cuts a longer failure
message (ADR run-event-note). An empty `runs` means the case never ran.

## Errors

| Code | When |
|---|---|
| `case.unknown` | no case with that id in the scope |
| `case.ambiguous` | a bare id matches cases in several projects |
| `project.unknown` | the qualifier or `project` names no project |
| `operation.invalid_input` | `ref` is not `TC-NNNN` or `<project>/TC-NNNN` |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
