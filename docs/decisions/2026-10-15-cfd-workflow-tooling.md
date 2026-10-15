# CFD workflow tooling: vendored skills, hooks and CI checks

## Status

Accepted — 2026-10-15

## Context

The repo adopted CFD's documents (`CLAUDE.md`, `docs/`, ADRs) but not its
procedures. Every ritual so far — session start, issue start, ADR creation,
session close — was run from memory, which the CFD catalog predicts degrades
under pressure. The methodology ships them as Agent Skills plus hooks and a CI
workflow (`templates/` in
[context-first-development](https://github.com/albertomarturelo/context-first-development),
catalog ADRs `agent-skills-as-procedures`, `distribute-commands-as-plugin`,
`enforce-rituals-with-hooks`). The team may use agents other than Claude Code.

## Decision

1. **Vendor the 8 CFD skills** into `.agents/skills/` (canonical, read by
   Codex/Copilot/Gemini) with `.claude/skills` as a **symlink** to it, from
   upstream commit `bf55ab8ddc65`. Manual-only rituals (`session-start`,
   `session-close`, `issue-new`, `issue-start`, `project-init`) keep
   `disable-model-invocation: true` and `agents/openai.yaml`.
2. **Local adaptations are minimal and listed** at the top of each changed
   `SKILL.md`: catalog paths become upstream URLs, and `review-pr`'s placeholder
   checklist is replaced with this repo's rules (ADRs + CONVENTIONS).
3. **Hooks** (`.claude/settings.json`): `SessionStart` injects
   `CURRENT_STATUS.md` + the ADR index; the `PreToolUse` commit guard is
   installed but dormant while `CURRENT_STATUS.md` is untracked (team mode).
4. **CI** `context-freshness.yml`: `adr-slug-unique` blocks duplicate ADR slugs
   on PRs **and on push to `main`** (local adaptation: work currently lands on
   `main` directly); the status-freshness job runs on PRs only and skips itself
   in team mode.
5. **Upgrades** re-copy from a newer upstream commit in one PR, re-apply the
   listed adaptations, and update the commit id here and in `docs/STACK.md`.
6. Not to be confused with the **product's** QA skills (`skills/qa-*`, #14),
   which casefile ships to its users' repos.

## Alternatives Considered

- **Claude Code plugin (`/plugin install cfd`)** — auto-updates, but serves
  Claude Code only and installs per user, not per repo; teammates on other
  agents would get nothing.
- **`npx skills add`** — installs into every detected agent, but adds a
  third-party installer to the workflow for what is a one-time copy of 8 folders.
- **Both plugin and copies** — rejected upstream: `/cfd:session-start` and
  `/session-start` would be the same procedure from two places.
- **Hooks only, no skills** — Claude Code-only; skills are the portable source.

## Consequences

- Sessions start with `/session-start`, pick work with `/issue-start <n>`, and
  end with `/session-close` (Codex: `$name`).
- Upstream fixes do not arrive automatically; upgrades are deliberate.
- The commit guard needs `jq`; without it, it fails open.
