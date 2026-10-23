# review

Changes one existing case: edits its fields, moves its state (approve, retire,
send back), or both. The agent calls it when the QA asks in the chat; the
viewer calls it when the QA edits the case page (ADR
human-writes-through-operations). casefile rewrites the file, appends the
`history` entries with one change id, and returns the commit to make. Nobody
edits a case file by hand.

- **Actor:** agent, human
- **CLI:** `casefile review <ref> [--set '<json>'] [--to <state>] [--note <text>] [--agent <name>] [--requested-by <email>] [--inbox <id>] [--base <change id>] [--project <name>] --json`
  (an agent runs it with `CASEFILE_ACTOR=agent`; read `commit` from the `--json` output)
- **Writes:** `**/context/tests/**/TC-*.md` (the one case file)

## Before calling it

1. Read the case as it is now: `casefile resolve <ref> --json`. Keep the
   `change` of its last `history` entry: pass it as `base`, so a change made
   meanwhile by someone else is refused instead of overwritten.
2. Change only what the human asked for. `set` replaces whole fields, so to
   add one step, send the full `steps` list with the step added.
3. An agent moves a state only when the human asked for that move in this
   session (or in the inbox item it is working on). Approving or retiring on
   its own judgement is not the agent's call.

## Input

| Field | Type | Meaning |
|---|---|---|
| `ref` | `TC-NNNN` or `<project>/TC-NNNN` | The case, looked up like `casefile resolve`. |
| `set` | object, optional | The fields to change, from the table below. Each one replaces the stored value; `null` removes it, so the case inherits it from its commons again. |
| `to` | `draft`, `in_review`, `active`, `retired`, optional | The state to move to (see Transitions). |
| `note` | text, optional | Why: written as the `note` of the `history` entries. |
| `identity` | email | Filled by the host: `CASEFILE_USER_EMAIL` when set, else `git config user.email` in the workspace (ADR identity-override; `casefile whoami` shows it): the person at the keyboard, who asked the agent or edited in the viewer. |
| `requestedBy` | email, optional | Agent only: the human who asked, when it is not `identity` (an inbox item's author). Refused for a human, so the entry and the commit always name the same person. |
| `agent` | text | The agent applying it (`claude-code`): the `Agent:` trailer. Required for an agent, refused for a human. |
| `inbox` | inbox item id, optional | When the request came through `.inbox/`. |
| `base` | change id, optional | The `change` of the last `history` entry the caller read. |
| `via` | text | Filled by the host: `cli:review` from the CLI, `ui:review` from the viewer. Written as `history[].via`. |
| `project` | project name | Filled by the host from `--project` or the project containing `--cwd`. |

`identity` and `via` are host inputs, never flags (ADR cli-generic-host).

At least one of `set` and `to` is required.

Fields `set` accepts (the case schema decides their shape):

| Field | `null` allowed | Notes |
|---|---|---|
| `title` | no | One line, unique in its feature, ignoring letter case and repeated spaces. |
| `steps` | no | `[{ do, expect, evidence? }]`, at least one: the whole list. |
| `preconditions`, `acceptance_ref`, `work_items` | yes | Whole lists. |
| `surfaces`, `layer`, `priority` | yes | `null` inherits from the commons. |
| `labels`, `data` | yes | Whole maps; label keys must be declared in `_properties.yaml`. |
| `automation` | per key | Merged per key: `{ eligible?, ref?, status? }`. `status` is `manual`, `candidate`, `in_progress` or `retired` (the test was dropped); `automated` and `flaky` are derived from runs and never set (ADR write-ownership). `ref: null` unlinks the test. |
| `notes` | yes | Markdown that replaces the body of the file, below the frontmatter. Absent: the body is kept byte for byte. |

`id`, `feature`, `origin`, `history`, `mirror` and `duplicates_checked_against`
cannot be set (`review.not_editable`). The state changes only through `to`.

## Transitions

| From | `to` | `history` event | Commit verb |
|---|---|---|---|
| `draft` | `in_review` | `review_requested` | request review of |
| `draft`, `in_review` | `active` | `reviewed` | approve |
| `in_review` | `draft` | `state_changed` | send back |
| `draft`, `in_review` | `retired` | `retired` | reject |
| `active` | `retired` | `retired` | retire |
| `retired` | `draft` | `state_changed` | reopen |

Cases are never deleted (`history` is append-only): a draft the QA does not
want is rejected, and stays in the repository as `retired`. Any other pair,
including moving to the state the case already has, is
`review.invalid_transition`. Editing fields never changes the state: an
`active` case whose steps change stays `active`.

## Behaviour

1. Finds the case (`case.unknown`, `case.ambiguous`). Its file must parse.
2. If `base` is given and is not the `change` of the case's last `history`
   entry, refuses with `review.stale`: someone changed it after the caller read it.
3. Checks everything before writing. If anything fails, nothing is written:
   - every field of `set` is editable and matches the case schema;
   - at least one value differs from the stored one, or `to` is given
     (`review.no_change`);
   - `to` is an allowed transition from the current state;
   - a new `title` is unique in the feature;
   - label keys are declared;
   - the changed case still resolves with its commons (`resolve.missing_field`).
4. Generates **one change id** (a UUID) for the call.
5. Appends to `history`, all with that change id, `at` = now (UTC),
   `by` = `requestedBy` when given, else `identity`, `via` and `inbox?` and `note?`:
   one `updated` entry when `set` changed something, then one entry for the
   transition when `to` is given. So one call writes one or two entries.
6. Rewrites the frontmatter in the format `cover` writes (`casefile spec
   cover`): keys `id`, `feature`, `title`, `state`, `origin`, then the other
   fields in schema order, then `history`. Comments inside the frontmatter
   are not kept. The body is kept byte for byte unless `set.notes` is given.
7. **Does not commit.** It returns the commit to make, of that one file:
   - **agent:** `commit.author` is `casefile-agent <casefile-agent@casefile.invalid>`
     and the message carries `Agent:`. `Requested-by:` is the same email as `by`. Commit it as `casefile spec cover` says
     (`git -c user.name=… -c user.email=… commit -F <message> -- <path>`).
   - **human:** there is no `commit.author` and no `Agent:` trailer. The commit
     is made with the human's own Git identity (`git commit -F <message> -- <path>`),
     or the one casefile resolved for them (ADR identity-override).
     From the CLI, the human runs it; the viewer runs it for them (ADR
     human-writes-through-operations). `commit.files` is that one path,
     workspace-relative: the pathspec to stage and commit, and nothing else.

   The subject is `review(<feature>): <verbs> <id>`, the verbs being `edit`
   when `set` changed something and the transition's verb, joined with `and`:
   `review(login): edit and approve TC-0003`.

**Postconditions:** `casefile resolve <ref>` shows the new values and state,
and its last `history` entries carry the returned `change`. `casefile
validate` reports nothing new for the file.

**Idempotency:** retrying a call that was applied writes nothing: the same
`set` is `review.no_change`, the same `to` is `review.invalid_transition`, and a
retry with `base` is `review.stale`. Commit the file of the first call instead.

## Output

```json
{ "ref": "web/TC-0003",
  "path": "apps/web/context/tests/login/TC-0003.md",
  "change": "5e1c7a2b-8d3f-4a6e-9b0c-2f4d6e8a1c3b",
  "state": "active",
  "changed": ["steps"],
  "events": ["updated", "reviewed"],
  "commit": {
    "author": "casefile-agent <casefile-agent@casefile.invalid>",
    "message": "review(login): edit and approve TC-0003\n\nRequested-by: qa@acme.example\nAgent: claude-code\nCasefile-Change: 5e1c7a2b-8d3f-4a6e-9b0c-2f4d6e8a1c3b\n",
    "files": ["apps/web/context/tests/login/TC-0003.md"] },
  "next": ["Commit the file with commit.author and commit.message taken from --json output, staging only it (`git commit -F <message> -- <path>`)"] }
```

`changed` lists the fields of `set` whose value changed, in schema order.
For a human, `commit` has no `author` and the message no `Agent:` line.

## Example

The draft `web/TC-0003` that `casefile spec cover` wrote. The QA reads it in
the viewer and asks in the chat: "the email must stay filled in; approve it".

```bash
CASEFILE_ACTOR=agent casefile review web/TC-0003 --to active --agent claude-code \
  --base 9d2f6a1e-3b4c-4d5e-8f90-1a2b3c4d5e6f --json --set '{
  "steps": [{ "do": "Submit a registered email with an empty password",
              "expect": "The form says the password is required, stays on the page and keeps the email" }] }'
```

The checkout's `git config user.email` is `qa@acme.example`, so that is
`identity`. It rewrites `apps/web/context/tests/login/TC-0003.md`:

```markdown TC-0003.md
---
id: TC-0003
feature: login
title: Reject an empty password
state: active
origin: agent
automation:
  ref: login.spec.ts::rejects an empty password
steps:
  - do: Submit a registered email with an empty password
    expect: The form says the password is required, stays on the page and keeps the email
duplicates_checked_against: [TC-0001, TC-0002]
history:
  - at: "2026-10-17T10:00:00Z"
    by: qa@acme.example
    via: cli:cover
    change: 9d2f6a1e-3b4c-4d5e-8f90-1a2b3c4d5e6f
    event: created
  - at: "2026-10-19T09:30:00Z"
    by: qa@acme.example
    via: cli:review
    change: 5e1c7a2b-8d3f-4a6e-9b0c-2f4d6e8a1c3b
    event: updated
  - at: "2026-10-19T09:30:00Z"
    by: qa@acme.example
    via: cli:review
    change: 5e1c7a2b-8d3f-4a6e-9b0c-2f4d6e8a1c3b
    event: reviewed
---
```

Had the QA approved it themselves on the case page, the viewer would have
sent the same `to` with actor human and `via: ui:review`, and committed as
the QA with the message
`review(login): approve TC-0003\n\nRequested-by: qa@acme.example\nCasefile-Change: <id>\n`.

## Errors

Nothing is written when any of these is returned.

| Code | When |
|---|---|
| `operation.invalid_input` | the input does not match its schema (with the field path), e.g. `automation.status: automated`, or neither `set` nor `to` |
| `review.not_editable` | `set` names `id`, `feature`, `origin`, `history`, `mirror`, `duplicates_checked_against` or `state` (use `to`) |
| `review.no_change` | every value in `set` equals the stored one and there is no `to` |
| `review.invalid_transition` | `to` is not allowed from the current state (Transitions) |
| `review.stale` | `base` is not the change of the case's last `history` entry: read it again |
| `review.agent_required` / `review.agent_not_allowed` | `agent` missing for an agent, or given by a human |
| `review.requested_by_not_allowed` | `requestedBy` given by a human: their own identity is used |
| `identity.missing` | the host found neither `CASEFILE_USER_EMAIL` nor `git config user.email` |
| `identity.invalid` | `CASEFILE_USER_EMAIL` or `git config user.email` is not an email (the message names which); nothing runs |
| `review.duplicate_title` | another case of the feature has that title |
| `label.undeclared` | a label key is not declared in the project's `_properties.yaml` |
| `resolve.missing_field` | after the change, a required field is set nowhere (e.g. `priority: null` with no commons value) |
| `case.unknown` / `case.ambiguous` | no such case, or a bare id found in several projects |
| `project.unknown` | `project` names no project |
| `operation.actor_not_allowed` | invoked by CI |
| loader codes | `casefile.yaml` cannot be read; run `casefile validate` |
