# Branch per issue, merged into main through a pull request

## Status

Accepted — 2026-10-15 (#18)

## Context

Until now every change was committed straight to `main`. That worked for one
person bootstrapping, but the team is growing, the vendored CFD skills
(`/review-pr`, `/session-close`) assume a pull request per unit of work, and
work units are already one GitHub issue per session (CONVENTIONS 11). Without a
PR there is no place for review, CI runs only after the change is on `main`,
and parallel agents in worktrees have nothing to rebase onto but each other.

## Decision

1. **One issue → one branch → one PR into `main`.** Branch from an up-to-date
   `main`, named `<issue>-<short-slug>` (e.g. `7-loader-resolver`), which is also
   GitHub's default for "create a branch" from an issue. Branches live for one
   session, at most a few days. No other long-lived branch exists.
2. **No direct commits to `main`.** Exception: none. Process-only changes go
   through an issue and a PR too (this ADR did, #18).
3. **Commits** use Conventional Commits subjects (`feat(core): …`, `docs: …`,
   `build: …`, `chore: …`, `fix: …`, `test: …`), English, ≤72 chars.
4. **PR shape** (`.github/PULL_REQUEST_TEMPLATE.md`): Conventional Commits
   title; body with `Closes #<n>`, the session summary from `/session-close`, and
   the issue's acceptance criteria copied verbatim as a checklist.
5. **Review.**
   - A teammate is available → they review the PR; their findings open the next
     session (CFD standing rule).
   - Solo → `/review-pr` on the local diff before `/session-close`, findings fixed
     in the same session, then the author merges.
6. **Merge** with **squash**, only when CI (`CI` and `Context freshness`) is
   green; the branch is deleted on merge. The squash commit keeps the PR title as
   subject and the commit trailers in its body.
7. **New ADRs land first.** An ADR that other in-flight work depends on is
   merged as its own PR before that work continues; other branches rebase onto
   `main` (CFD standing rule for parallel worktrees).

## Alternatives Considered

1. **Keep committing to `main`** — fastest for one person, but no review
   surface, CI runs after the fact, and `/review-pr` and `/session-close` lose
   the PR they are written around.
2. **Git Flow (`develop` + release branches)** — adds a long-lived integration
   branch and merge choreography that a pre-1.0 library with one deliverable
   does not need; releases can be tags on `main`.
3. **Merge commits or rebase-merge instead of squash** — keep every
   intermediate commit on `main`; with one issue per session, one commit per
   issue on `main` is the more useful history. Rebase-merge is acceptable to
   revisit if per-commit history starts to matter.

## Consequences

- `main` is always green and every change on it maps to one issue and one PR.
- The context-freshness slug check (ADR cfd-workflow-tooling) now runs on PRs
  before merge, not only after the fact.
- Squash merges fold commit messages into one body. Same constraint as
  [history-commit-reference](2026-10-15-history-commit-reference.md) for user
  repos: messages must be kept, not hand-trimmed.
- Branch protection on `main` is the mechanical backstop (enabled 2026-10-15):
  PR required with 0 mandatory approvals (so the solo path works), required
  checks `check (22)`, `check (24)` and `adr-slug-unique`, branch up to date
  before merge, enforced for admins; merged branches are deleted automatically.
  A new required check must be added there when a workflow job is added.
