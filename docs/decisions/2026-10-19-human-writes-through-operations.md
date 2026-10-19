# The QA writes cases from the viewer through core operations

## Status

Accepted — 2026-10-19 (#89). Supersedes
[agent-is-sole-writer](2026-10-15-agent-is-sole-writer.md). Amends
[write-ownership](2026-10-15-write-ownership.md) (case files and `.runs/` rows),
[local-ui-stack](2026-10-17-local-ui-stack.md) §2 (the UI is no longer
read-only; the write path it postponed is decided here) and
[authoring-loop-first](2026-10-19-authoring-loop-first.md) §2 (the chat is one
intent channel, the viewer is the other; `.inbox/` stays deferred).

## Context

agent-is-sole-writer rejected hand-edited YAML and a UI that writes files with
its own validation, to keep provenance clear and files well-formed. Since then,
core produces ids, key order, `history` entries, change ids and trailers for
whichever host calls an operation
([agent-driven-setup](2026-10-15-agent-driven-setup.md),
[agent-runs-the-commit](2026-10-17-agent-runs-the-commit.md)), and Git identity
says who decided ([git-is-identity](2026-10-15-git-is-identity.md)). The
maintainer (2026-10-19): the QA must edit cases from the viewer — change,
approve, retire, record a manual result, create a case. It is important. A
ticket-like path through `.inbox/` would make the QA wait for an agent session
to see their own edit.

## Decision

1. **Humans write case and run files only through core operations, like the
   agent:** `review` (edit, approve, retire), `cover` (create a draft), `run`
   (record a result). Those operations declare `actor: ["agent", "human"]` and
   core validates both the same way. Nothing else writes under `context/tests/`.
2. **The viewer is the human's host.** Its server invokes with actor `human`
   and runs the returned commit as the human: `git add -- <files>`,
   `git commit -F <message> -- <files>`, with the user's own identity from
   `git config`, never `-c user.*`. A human commit carries `Requested-by:` (the
   human) and `Casefile-Change:`, no `Agent:` trailer. `history[].by` is the
   human's email and `via` is `ui:<operation>`.
3. **The write path is guarded before any write ships** (#91): a writing
   request must come from the server's own origin (`Origin`, or
   `Sec-Fetch-Site: same-origin`) and carry a token generated at server start,
   handed to the page by `GET /api/session`, never in a URL. Read-only
   operations stay open. `127.0.0.1` without auth was acceptable only read-only.
4. **What stays derived:** `automated`/`flaky` are written by nobody; a human
   run (`executor: human:*`) never carries `automation_ref`, so it cannot prove
   automation (write-ownership rule 2 holds).
5. **The agent keeps what only it can do:** bootstrap and cover from the code at
   scale, and apply what the QA asks in the chat. `.inbox/` remains the way to
   ask the agent asynchronously; still deferred.

## Alternatives Considered

- **Edits as `.inbox/` intents the agent applies** — keeps the old ADR intact,
  but the QA waits for an agent session to see their own change: a ticket, not
  editing. Rejected by the maintainer.
- **The UI edits files with its own code** — a second validation path, the
  thing agent-is-sole-writer rightly rejected. Still rejected.
- **The server commits as a tool identity (`casefile-ui`) naming the human in
  a trailer** — hides who decided behind a tool; the audit (#41) reads authors.
- **Leave the files uncommitted for the human to commit** — `history[].commit`
  stays `null`, half-done states sit in the working tree, and the UI cannot
  tell the human what to commit.

## Consequences

- agent-is-sole-writer is Superseded. write-ownership's table reads: case
  files — agent or human, via operations; `.runs/` — human via the `run`
  operation (not an intent). Its rule 3 (audit) gains: a human commit that
  touches case files without `Casefile-Change:` is a hand edit → finding.
- #83 and #84: `review` with both actors, `cover` accepts `human`,
  `commitMessage` makes `agent` optional. #90 `run` operation. #91 write path,
  then #92 edit/approve/retire, #93 record a result, #94 create a case.
- The `cover` SPEC says actor agent until #84 ships (code is the truth).
- README's principle "the agent is the only writer" becomes "cases are written
  only through core operations, by the agent or the QA; Git says who".
- The MCP host (#15) follows the same rule: actor from the caller, the host
  commits.
