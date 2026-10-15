# Write ownership under context/

## Status

Accepted — 2026-10-15. Resolves the conflict noted in
[agent-is-sole-writer](2026-10-15-agent-is-sole-writer.md) (#1).

## Context

The brief says the agent is the sole writer under `context/tests/`, yet CI ingests
results into `context/tests/.runs/` and "the system" flips
`automation.status: automated`. Ownership must be stated per path and per
**actor**, not per app: the CLI can be driven by a human, the agent or CI, so
"the CLI may write X" says nothing.

## Decision

| Path / field | Writer | Via |
|---|---|---|
| `context/tests/**/*.md`, `_common.yaml`, `_properties.yaml` | agent only | operations (`cover`, `review`, `inbox`, …) |
| `context/tests/.inbox/<hash>/*.yaml` — create | human | web UI / CLI, committed as the human |
| `context/tests/.inbox/…` — `status`, `result` | agent | `inbox` operation |
| `context/tests/.runs/<run-id>.jsonl` — append only | CI (`executor: ci:*`), agent (`executor: agent:*`); human via a `run` intent (`executor: human:*`) | ingesters / `run` operation |
| `context/releases/policy.yaml` | agent, on a human intent | `release` operation |
| `automation.status` ∈ {`automated`, `flaky`} | **nobody — derived** | resolver, from `.runs` events matching `automation.ref` |
| `automation.status` ∈ {`manual`, `candidate`, `in_progress`, `retired`} | agent | stored in the case file |
| `mirror.*` | bridges, run by the agent | `push` / `pull` |

Rules:

1. Ownership is declared on each operation (`actor`, `writes`, see
   [extension-model](2026-10-15-extension-model.md)) and enforced in core.
2. CI only **appends new files** under `.runs/`; it never touches a case.
   "Automated" therefore cannot be faked by the agent: it exists only if a real
   run event with a matching `automation.ref` exists.
3. There is no real access control — anyone with Git access can edit anything.
   Enforcement is **by audit**: `casefile validate` in CI reads commit author
   and trailers and reports writes that violate this table. This is consistent
   with [git-is-identity](2026-10-15-git-is-identity.md).

## Alternatives Considered

- **Ownership per app** — rejected; an app does not identify the actor.
- **CI writes `automation.status` into the case** — creates a second writer of
  case files and a race with the agent; deriving the value avoids both.
- **CI opens an inbox item and the agent records the run** — keeps the agent as
  literal sole writer, but makes result ingestion depend on an agent session;
  CI results must land without one.
- **Git hooks / branch protection as enforcement** — environment-specific;
  audit in `validate` works everywhere and stays in files.

## Consequences

- The case-file schema stores only the four manual statuses; `automated`/`flaky`
  appear on the **resolved** case (affects #5, #7).
- `validate` needs the audit rule (affects #9).
- `agent-is-sole-writer` is read as "sole writer of case and commons files".
