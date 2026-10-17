# CI commits its run files to the branch it tested

## Status

Accepted — 2026-10-17 (#70). Names the CI writer of `.runs/` in
[write-ownership](2026-10-15-write-ownership.md); applies
[agent-runs-the-commit](2026-10-17-agent-runs-the-commit.md) to `ingest`, which
amends a consequence of [ingester-contract](2026-10-17-ingester-contract.md).

## Context

`casefile ingest` appends events to `.runs/<run>.jsonl` and commits nothing
(ingester-contract). Nothing says how a CI job gets that file into the
repository, or what author and trailers the commit carries, and the
write-ownership audit (#41) recognises writers by author. The first real case
(#35) had the agent ingest locally for that reason. Constraints:
write-ownership says CI results must land without an agent session; casefile
reads runs only from the repository's files (files-are-source-of-truth);
protected branches need a PR, and squash merges fold each commit's author
into the PR author's; run ids are unique per run, so new run files do not
conflict, but shards ingested separately into one run id do (`specs/ingest.md`).

## Decision

1. **Only runs of shared branches are recorded:** the default branch and
   release branches, on `push`. A pull-request run tests unmerged code: its
   report stays a CI artifact and nothing is committed.
2. **`ingest` returns the commit**, like every writing operation:
   `commit: { author, message }` and the run file it wrote, built by core's pure
   formatter. Subject `runs: record <run> for <project>`, then the trailers
   `Casefile-Run: <run>`, `Executor: <executor>` and, when the host passes it,
   `Tested-Commit: <sha>` (GitHub: `$GITHUB_SHA`). The author follows the actor:
   CI ingests as `casefile-ci`, an agent as `casefile-agent`. These trailers
   replace `Requested-by:`/`Casefile-Change:`: a run writes no `history` entry
   and answers no one's intent. Nothing to commit when nothing was appended.
3. **The CI identity is `casefile-ci <casefile-ci@casefile.invalid>`**, the same
   in every repository and CI vendor, `.invalid` for the reason given in
   agent-runs-the-commit §3.
4. **CI runs that commit and pushes it to the branch it tested**, exactly as
   agent-runs-the-commit §2: `git add <path>`, then
   `git -c user.name=casefile-ci -c user.email=casefile-ci@casefile.invalid commit -F <message> -- <path>`,
   then `git push`. If the branch moved, `git pull --rebase` and push again (a
   few tries): a new run file never conflicts.
5. **One record job per run.** Test jobs and shards upload their reports as
   artifacts; one job that `needs` them all and runs `if: always()` (failures
   are what must be recorded) downloads them, merges shard reports, ingests
   once and commits once. This removes the shard conflict of `specs/ingest.md`.
   The tests workflow ignores pushes that only touch `**/context/tests/.runs/**`,
   so the record commit does not start another run.
6. **Pushing past protection is the repository owner's grant:** a protected
   branch lists the credential CI pushes with (a deploy key or a GitHub App) as
   the only bypass of its rules. casefile ships the GitHub Actions template and
   the setup steps in a SPEC; other CI vendors follow §4–§5 with their own credential.
7. **The audit (#41) bounds that credential:** a `casefile-ci` commit may only
   add lines to `**/context/tests/.runs/*.jsonl`, every added event has a `ci:*`
   executor and the file is `<Casefile-Run>.jsonl`. Anything else in it, or a
   `ci:*` event committed by another author, is a finding.

## Alternatives Considered

1. **CI opens a PR with the run file** — protection stays as it is, but one PR
   per run, a required review that blocks auto-merge, and PRs opened with
   `GITHUB_TOKEN` trigger no checks: it needs the same App credential as a
   push, plus a queue, and runs reach the branch late.
2. **CI uploads the file as an artifact; the agent commits it later** — CI
   never writes, but results would wait for an agent session (the alternative
   write-ownership rejects), artifacts expire (90 days on GitHub), gates would
   read stale runs, and `ci:*` events would arrive under the agent's name.
3. **CI pushes to an unprotected `casefile-runs` branch, merged now and then** —
   no bypass needed, but runs are not where casefile reads them until someone
   merges, and reading them from the ref instead breaks "the loader reads the
   working tree".
4. **CI commits on the pull-request branch** — runs would ride the PR's merge,
   but the squash erases the bot author, a `GITHUB_TOKEN` push re-runs no
   required check (the PR cannot merge), fork PRs get no write token, and the
   runs describe code that may never merge.
5. **The CI vendor's own identity** (`github-actions[bot]`) — differs per
   vendor and per setup; the audit needs one fixed author, as for the agent.
6. **`ingest` commits itself** — rejected for the same reasons as core
   committing in agent-runs-the-commit: hooks, signing and staging stay with
   the caller.

## Consequences

- `ingest` gains `commit` in its output and an optional `tested_commit` host
  input; the ingester-contract consequence "the operation makes no commit"
  becomes "the operation returns the commit; the caller runs it".
- A protected branch needs a push credential with a bypass; it can push
  anything, so the audit is the real limit and unsigned authorship stays
  spoofable (git-is-identity). Owners who refuse the bypass record no CI runs.
- A release branch squash-merged into the default branch folds `casefile-ci`
  commits into the merger's: #41 must accept run lines whose `Casefile-Run:`
  trailer text survives in the squash body.
- Follow-up issue: `ingest` returns the commit, `specs/ingest.md`, and a
  GitHub Actions template with its SPEC (record job, bypass setup); the
  npm-login example gets its workflow from it. The `casefile-ci` rule (§7)
  joins #41's acceptance criteria.
