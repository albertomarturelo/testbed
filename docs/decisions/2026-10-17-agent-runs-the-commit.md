# Writing operations return the commit; the agent runs it

## Status

Accepted — 2026-10-17 (#55). Fixes the `casefile-agent` identity left open by
[git-is-identity](2026-10-15-git-is-identity.md). Amends a consequence of
[history-commit-reference](2026-10-15-history-commit-reference.md): the writing
operation, not the Git utilities, generates the change id and formats the
trailers. Narrows #51 (no commits).

## Context

[agent-driven-setup](2026-10-15-agent-driven-setup.md) says the agent decides and
the library writes. Ids, change ids, file shapes and trailers are where models
slip, so core must produce them. Writing operations such as `cover`, `review`
and `inbox` also need a commit per change.
[git-is-identity](2026-10-15-git-is-identity.md) says that commit is authored by
`casefile-agent` with trailers, and
[history-commit-reference](2026-10-15-history-commit-reference.md) says it
carries the `Casefile-Change:` id that the `history` entries store. Nothing
yet says who runs `git commit`, and `casefile-agent` has no email.

## Decision

1. **A writing operation does not commit.** It writes its files and returns
   `commit: { author, message }`. The message is the full text: subject, blank
   line, then the trailers `Requested-by:`, `Inbox-Id:` (when there is one),
   `Agent:` and `Casefile-Change:`. Core builds it with a pure formatter. The
   operation also returns the files it wrote.
2. **The agent runs the commit, of exactly those files.** First
   `git add <paths>`, then
   `git -c user.name=casefile-agent -c user.email=casefile-agent@casefile.invalid commit -F <message> -- <paths>`.
   The pathspec matters: without it, `git commit` also takes whatever the
   human had staged, and that would land under the agent's name. Skills say
   this once and cite the operation's SPEC.
3. **The agent identity is `casefile-agent <casefile-agent@casefile.invalid>`**,
   the same in every repository. `.invalid` is reserved (RFC 2606), so the
   address cannot belong to anyone. The write-ownership audit (#41) recognises
   agent commits by this author and their trailers.
4. **Change id:** core generates it (`crypto.randomUUID()`) once per invocation
   and writes it to every `history` entry and to the trailer.

## Alternatives Considered

- **Core commits through a Git adapter (#51 as written)** — the change and its
  commit could never diverge. But core would run `git commit` inside the user's
  checkout with whatever is already staged, hooks and signing set up. It would
  have to handle failures (a hook rejects, there is nothing to sign with) as
  operation errors, and the agent, which already drives Git in the session,
  would lose control of when to commit. Revisit if agents are seen to change the
  message or stage extra files.
- **The agent writes the message and trailers itself** — no core code, but
  trailer names, the change id and the blank-line rule are exactly where models
  slip (ADR agent-driven-setup, alternative 2).
- **Author the commit as the human** — loses the line between decision and
  execution (ADR git-is-identity).
- **A real or project-specific email for `casefile-agent`** — someone has to own
  it, and it would differ per repository. The audit needs one fixed identity.

## Consequences

- Between the operation and the commit, the files are uncommitted. Their
  `history[].commit` resolves to `null` (pending, not an error, per
  history-commit-reference). A retry is guarded by each operation, e.g.
  `cover.duplicate_title`.
- #51 keeps identity (`git config user.email`), trailer parsing and the log scan
  (change id → sha). The pure message formatter ships with the first writing
  operation (`cover`), and committing leaves #51's scope.
- Every writing operation's SPEC documents `commit` in its output, and its skill
  runs the commit exactly as point 2 says.
