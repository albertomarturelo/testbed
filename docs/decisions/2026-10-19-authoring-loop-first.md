# The authoring loop is the product; runs and CI are a complement

## Status

Accepted — 2026-10-19 (#82). Ranks the roadmap of
[initial-architecture](2026-10-15-initial-architecture.md). Defers the write
path of [local-ui-stack](2026-10-17-local-ui-stack.md) (`.inbox/` intents from
the UI) without changing its design. [ingester-contract](2026-10-17-ingester-contract.md),
[run-event-note](2026-10-17-run-event-note.md) and
[ci-commits-run-files](2026-10-17-ci-commits-run-files.md) stay as they are.

## Context

The brief says the agent proposes, maintains, runs and reports cases and a QA
orchestrates from a local UI. "Real case first" (#35) chose npm-login *with a
Playwright run*, and every gap that run exposed became run plumbing: JUnit
ingest (#17), run history and failure notes (#68), CI run files (#70), failure
causes (#76), blocked results (#67), a CI template (#73), more formats (#57).
Six of the last eight sessions, and three of the next five, served execution.
Meanwhile nothing lets the agent *maintain* a case: `cover` only drafts, so a
QA asking for a changed step, an approval or a retirement has no operation
behind it, and the viewer shows fields, not a document.

The maintainer restated the product on 2026-10-19: a QA takes a repository or
monorepo, installs casefile, creates and maintains the cases together with an
agent that has the code as context, and reads them in a viewer that is pleasant
to a human. The product is visual and documentary. Executing tests is a complement.

## Decision

1. **The loop every ranking serves:** install → `casefile-setup` → the agent
   drafts cases from the code, the tests and the acceptance criteria → the QA
   reads them in the viewer → the QA asks for changes in the chat → the agent
   applies them through operations → the QA approves. Work is ranked by how
   much of this loop it closes. A case with no run is a complete, first-class
   case; `automation` and `.runs/` enrich it, they do not define it.
2. **The chat is the intent channel.** While an agent session is open, the QA
   speaks and the agent acts. The viewer stays read-only; `.inbox/` intents
   written by the UI, and the origin check they need, wait until a human must
   act without an agent session.
3. **Maintaining a case is a core operation, `review`:** edit fields and steps,
   approve (`draft → active`), retire; one `history` entry, one change id, the
   commit returned ([agent-runs-the-commit](2026-10-17-agent-runs-the-commit.md)).
   Bootstrapping a whole project is a skill over `cover` and `project add`, not
   a new operation, until a real case shows it needs one.
4. **The viewer reads like a document:** body, preconditions, data, steps,
   references; coverage per feature; drafts awaiting review; live reload (#26)
   so the QA sees what the agent writes while they talk.
5. **Complements:** ingesters, CI templates, gates, the Git audit, MCP and the
   bridges are kept and shipped, but ranked after the loop and picked up when
   the real case needs them, not because a gap in a run exposed them.
6. **The showcase stays `examples/npm-login`** because its cases are understood
   without reading code, which is what makes the viewer convincing. Its
   *authoring* flow is what gets exercised now (bootstrap from its e2e tests and
   README, review of the drafts, approvals), not its Playwright flow. A
   code-heavy repository can be a second example later.

## Alternatives Considered

- **Keep "real case first" as practised** — every gap in the Playwright flow
  yields ingest work and the QA never gets to maintain a case. Rejected.
- **Let the UI write intents now** — a second intent channel, with an origin
  check and a token, before a single case has been approved. The chat already
  carries intent while an agent session is open. Deferred, not rejected.
- **Switch the showcase to a code repository (this monorepo)** — closer to
  "the agent has the code as context", but its cases need code to be understood
  and the showcase would stop being visual. Second example, not first.
- **Let the agent edit case files directly, no `review` operation** — breaks
  [agent-driven-setup](2026-10-15-agent-driven-setup.md) (core produces ids,
  history and trailers) and the write-ownership audit cannot tell a review
  from a hand edit.

## Consequences

- Tracker: #83 SPECs `review` + `bootstrap`, #84 `review` operation, #85 skills
  `qa-bootstrap` + `qa-review` tried on npm-login, #86 case page as a document,
  #87 coverage per feature and drafts filter; #26 follows them. #12 narrows to
  `run`, `triage`, `inbox`; #14 to `qa-run`, `qa-release`, `qa-inbox`.
  #67, #73, #57, #47, #41, #51, #15 are complements.
- README gains the principle "Authoring first" and its Today / Next table is
  ranked by the loop.
- ARCHITECTURE's `.inbox/` flow stays as design; the Inbox screen is "after
  the loop", not F1.
- Nothing in core changes: the resolver, `.runs/` and the derivation of
  `automated` are untouched.
