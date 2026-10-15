# history[].commit is derived from a change id, not stored

## Status

Accepted — 2026-10-15 (#2)

## Context

The brief gives each `history[]` entry a `commit` field. A file cannot contain the
hash of the commit that introduces it: the hash depends on the content, so
writing it changes it. Even a hash written later is fragile: rebase, cherry-pick
and squash-merge — routine on GitHub — all produce new hashes, silently breaking
every stored reference. `history` is also append-only (CONVENTIONS #5), so any
"fill it in later" scheme is a rewrite.

Not every change has an inbox item (`Inbox-Id`): the agent may run
`/qa-cover` directly from the terminal. The inbox id cannot be the link.

## Decision

1. **Every commit that casefile makes carries one trailer `Casefile-Change: <id>`**,
   where `<id>` is a random UUID (`crypto.randomUUID()`, no dependency) generated
   by core when the operation starts. It sits next to the existing trailers:

   ```
   cover(payments/refunds): propose 3 cases for AC-5

   Requested-by: qa@example.com
   Inbox-Id: 7f3c…
   Agent: claude-code
   Casefile-Change: 3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44
   ```

2. **Every `history[]` event written in that commit stores `change: <id>`** with
   the same value. The stored entry is
   `{ at, by, via, change, inbox?, event, note? }` — no `commit` field in the file.

3. **`commit` is derived** on the resolved case, like `automated`/`flaky` in
   [write-ownership](2026-10-15-write-ownership.md): core scans `git log` for
   messages containing `Casefile-Change: <id>` and exposes
   `history[i].commit = <sha> | null`. The scan matches the line **anywhere in the
   message**, not only in the trailer block, because GitHub squash-merge folds the
   original messages into the body.

4. **`casefile validate` checks** (new rules for #9):
   - every `change` id is a UUID and is unique per commit (one change per commit);
   - with full history available, every `change` resolves to exactly one commit
     reachable from `HEAD` that touches the file → otherwise **error**;
   - events in uncommitted working-tree changes resolve to `null` → **pending**,
     not an error;
   - in a shallow clone, unresolved changes are a **warning** and the report says
     the check was partial (CI can opt into `fetch-depth: 0` for the strict check).

## Alternatives Considered

- **Store the parent commit (`HEAD` at write time)** — deterministic and writable,
  but means "the state this was based on", not "the change"; readers will misread
  it, and it still breaks on rebase.
- **Backfill the hash in a follow-up commit** — violates append-only `history`,
  doubles the number of commits, and the backfill commit itself is unreferenced.
- **Use `Inbox-Id` as the link** — absent for changes not driven by the inbox.
- **Trailer named `Change-Id`** — the Gerrit convention; repos using Gerrit's
  commit-msg hook would get two conflicting `Change-Id` lines. A prefixed name
  avoids the collision.
- **ULID / sequential ids** — ULIDs need a dependency or custom code for no gain
  (ordering comes from `at`); sequential ids collide across branches.
- **Drop the link entirely, rely on `git log -- <file>`** — loses the mapping
  from a specific event to its commit when one file changes in many commits.

## Consequences

- The history-entry schema replaces `commit` with `change` (#5); the resolved
  case adds derived `commit` (#7).
- Git utilities generate the change id and add the trailer; trailer parsing
  matches it anywhere in the message (#10).
- `validate` gains the rules in point 4 (#9).
- History survives rebase, cherry-pick and squash-merge as long as commit
  messages are kept. Squash with a hand-edited message that drops the line
  breaks the link; `validate` reports it.
- [git-is-identity](2026-10-15-git-is-identity.md): the trailer set becomes
  `Requested-by`, `Inbox-Id`, `Agent`, `Casefile-Change`.
