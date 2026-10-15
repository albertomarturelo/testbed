# casefile

casefile is an open-source (MIT) TypeScript framework that keeps test cases as files
in the product repo, next to the code they verify. An AI agent proposes, maintains,
runs and reports cases through skills; a human QA orchestrates from a local UI;
Zephyr/Xray/TestRail are mirrors, never the source of truth.

## Context (read on demand — links, not imports)

- [Issues](https://github.com/albertomarturelo/testbed/issues) — the tracker; one issue per session (`gh issue view <n>`)
- [Current status](docs/CURRENT_STATUS.md) — read first every session (local, gitignored)
- [Decisions index](docs/decisions/_index.md) — read first every session
- [Conventions](docs/CONVENTIONS.md) — read before writing code
- [Architecture](docs/ARCHITECTURE.md)
- [Stack](docs/STACK.md)

## Commands

Not available yet (no workspace scaffold). Planned:

- Install: `pnpm install`
- Build: `pnpm build`
- Test: `pnpm test`
- Lint/format: `pnpm lint` (Biome)
- CLI from source: `pnpm casefile <command>`

## Standing rules

- Session start: read docs/CURRENT_STATUS.md and
  docs/decisions/_index.md first (~1k tokens). Never scan source
  code just to orient yourself.
- Work in one tracker issue at a time, sized to one session, with
  the sections Context / Target / ADRs to load / Acceptance criteria
  / Estimated sessions. If it needs more than one session, split it
  before starting. The issue body is the spec.
- Before writing code: read docs/CONVENTIONS.md.
- Before modifying an existing file: read it. Never edit unread code.
- When a significant decision surfaces (new dependency, new pattern,
  new strategy): STOP. Write docs/decisions/YYYY-MM-DD-<slug>.md
  FIRST (the slug is its ID; never a sequence number) —
  including the alternatives you rejected and why — update
  _index.md, then implement.
- When the user corrects a pattern: fix the code AND append the rule
  to docs/CONVENTIONS.md in the same change. A correction that is
  not documented will be repeated.
- Review before close when the user reviews alone: check the diff
  against the issue's acceptance criteria, docs/CONVENTIONS.md and
  the ADRs it lists, and fix the findings in this session. When a
  teammate reviews the PR, close first; their findings open the next
  session.
- Session close, before the session's final commit: update
  docs/CURRENT_STATUS.md (move finished items to Recently Completed,
  re-rank Next Priorities, refresh the date) and ship tracked docs/
  changes in the SAME commit/PR as the code.
- Keep sessions short: when you drift from these rules or the context
  fills with tool output, close and restart at the next acceptance
  criterion. State lives in docs/, so nothing is lost.
- Precedence: code is the truth about WHAT the system does; ADRs are
  the truth about WHY. If a doc contradicts the code, stop and flag
  it — do not silently trust the doc, and do not "fix" correct code
  to match a stale doc.
- All of these context files are written in English.
- Teams of 2+ developers, or parallel agents in git worktrees: add
  docs/CURRENT_STATUS.md to .gitignore. It is per-session memory;
  shared in-flight state lives in the issue tracker.
- Parallel agents in worktrees: one issue per worktree, no two
  issues touching the same paths. A new ADR lands on main as its own
  PR before work continues; the other worktrees rebase onto it.
