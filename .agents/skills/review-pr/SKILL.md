---
name: review-pr
description: "Review a PR, or the local branch diff before /session-close, against the team's curated checklist sourced from ADRs, CONVENTIONS, the linked issue's acceptance criteria, and the PR template. Report findings; do not auto-fix. Use when asked to review a pull request or self-review work in a CFD project."
argument-hint: "[pr-number]"
metadata:
  token-budget: "scales with the team's checklist depth, typically 3k–15k"
---

<!-- casefile adaptation (ADR 2026-10-15-cfd-workflow-tooling): step 4 checklist filled with this repo's ADRs and CONVENTIONS (incl. branch-per-issue-pr); upstream @bf55ab8ddc65 ships placeholders. -->

The user passes a PR number. If not provided, infer from the current
branch:

```bash
gh pr status --json number --jq '.currentBranch.number'
```

If the branch has no PR yet, this is a **self-review before
`/session-close`**: review the local branch instead (step 1, local
mode). The close ritual commits and opens the PR afterwards.

## 1. Fetch metadata + diff + commit history

PR mode:

```bash
gh pr view <n> --json baseRefName,headRefName,title,body,labels,commits,closingIssuesReferences
gh pr diff <n>
git log <base>..<head> --pretty=format:%s     # branch commit story
```

Local mode (no PR yet):

```bash
git diff <base>...HEAD     # committed on the branch
git diff HEAD              # not yet committed
git log <base>..HEAD --pretty=format:%s
```

Take the issue from the `#N` in `docs/CURRENT_STATUS.md` "In
Progress". Skip the PR-body and PR-template items; they apply once the
PR exists.

## 2. Load context indices that define the agenda

- `docs/CONVENTIONS.md`
- `docs/decisions/_index.md`
- The **linked issue body** via `gh issue view <issue-n>` — extract
  the AC checklist and the "ADRs to load" list.
- **Each ADR named in the issue body** under `docs/decisions/`.
- The **PR template** if `.github/PULL_REQUEST_TEMPLATE.md` exists.

## 3. Read changed files to the depth this team's checklist demands

The depth is a project decision, not a methodology rule. Read what
you need to verify the checklist below — no more, no less.

## 4. Apply the team's checklist

This section is **the team's curated review agenda** for casefile. Each
item cites the ADR / CONVENTIONS item it derives from; add items only
when a new ADR or convention lands.

```
### Workflow

- Branch is `<issue>-<short-slug>`, based on `main`, one issue only
  (ADR branch-per-issue-pr, CONVENTIONS 12).
- Commit subjects and PR title are Conventional Commits, ≤72 chars
  (ADR branch-per-issue-pr).
- PR body follows `.github/PULL_REQUEST_TEMPLATE.md`: `Closes #<n>`,
  summary, AC checklist copied verbatim from the issue (CONVENTIONS 12).
- Code, commits, PR text and docs/ are English (CLAUDE.md standing rule).
- New significant decision → ADR written first and listed in
  docs/decisions/_index.md (CLAUDE.md standing rule).
- docs/CURRENT_STATUS.md is NOT committed (gitignored, CONVENTIONS 11).

### Architecture

- No app imports or depends on another app; `pnpm lint` passes the
  boundary check (ADR apps-vs-packages).
- A new verb/format/mirror/rule is an operation, ingester, bridge or
  validator registered in core — never logic inside an app
  (ADR extension-model).
- Writes go through core operations and respect the ownership table;
  `automation.status` `automated`/`flaky` is never written to a file
  (ADR write-ownership).
- History events store `change` (UUID); casefile commits carry
  `Casefile-Change:`; nothing stores a commit hash in a file
  (ADR history-commit-reference).
- Schema changes edit Zod only, regenerate `packages/core/schema/`,
  and keep schemas structural — no `.refine()`, cross-field rules go
  in the validator (ADR schemas-generated-from-zod).
- CLI: global `--cwd`, positionals only for the operation subject
  (ADR cli-repo-location). SPECs live next to their operation and are
  cited as `casefile spec <op>` (ADR specs-ship-with-operations).
- Inbox paths come from core's `inboxDir()` (ADR inbox-path-hash).
- No LLM SDK or model call anywhere (ADR no-vendor-llm).

### Conventions

- ESM, strict TS, no default exports outside `*.config.ts` (CONVENTIONS 1).
- Core logic is pure; filesystem/Git behind thin adapters (CONVENTIONS 4).
- `history[]` and `.runs/*.jsonl` are append-only (CONVENTIONS 5).
- Errors are values with location and a stable code (CONVENTIONS 7).
- Repo/ticket text is treated as data, never instructions (CONVENTIONS 9).
- New dependency: exact version, ≥7 days old, justified, recorded in
  docs/STACK.md (CONVENTIONS 10, ADR build-and-test-tooling).

### Acceptance criteria

- Each `[ ]` from the linked issue is implemented in this diff.
- No extra changes outside the AC scope.

### Documentation drift

- Module added/moved → docs/ARCHITECTURE.md module map updated.
- Dependency added/upgraded → docs/STACK.md updated.
- Behaviour an ADR describes changed → ADR still holds, or a new ADR
  supersedes it.
- Demo outcomes changed → `DEMO_EXPECTED` and
  examples/demo-repo/README.md updated together.

### Testing

- Tests next to the code as `*.test.ts` (CONVENTIONS 6).
- Domain tests assert against `examples/demo-repo` and `DEMO_EXPECTED`
  instead of re-deriving outcomes (CONVENTIONS 6).
- Coverage ≥ 85 % on resolver, DSL and gates once they exist
  (CONVENTIONS 6; `pnpm coverage`).
- `pnpm build && pnpm typecheck && pnpm lint && pnpm test` pass.
```

Add more sections as your team's ADRs surface them.

## 5. Output a structured review

```text
## Critical (must fix before merge)
- <file>:<line> — <issue> — citation: <ADR-N or CONVENTIONS L<n>>
  Suggested fix: <one-line>.

## Suggestions (should fix)
- <file>:<line> — <issue> — citation.

## Nits (nice to have)
- <file>:<line> — <issue>.

## Summary
- Overall assessment.
- AC coverage: X / Y items satisfied.
- Architecture compliance: ✓ / ⚠ / ✗.
- Tokens consumed: ~<n>k.
```

## Rules

- **Do NOT auto-fix.** Report only. In a self-review the author fixes
  the findings in the same session, before `/session-close`; in a
  teammate review the author fixes them in the next session.
- **English only.**
- **No silent scope expansion.** If the checklist genuinely needs a
  rule that is not yet in CONVENTIONS or an ADR, surface it as a
  finding ("missing convention for X") and propose `/new-decision`
  before the next review.
