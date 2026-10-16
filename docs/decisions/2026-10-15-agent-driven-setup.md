# Setup is driven by the agent; the library scaffolds and validates

## Status

Accepted — 2026-10-15 (#23). Amends [specs-ship-with-operations](2026-10-15-specs-ship-with-operations.md)
(topic SPECs) and clarifies [write-ownership](2026-10-15-write-ownership.md) for `casefile.yaml`.

## Context

Setting casefile up in a repo means deciding which projects exist
([workspace-and-projects](2026-10-15-workspace-and-projects.md)), what the
feature tree looks like and what the commons say. That needs judgement, and
casefile never calls an LLM ([no-vendor-llm](2026-10-15-no-vendor-llm.md)): the
user's agent will do it by following skills. The library must keep this simple
and must report problems precisely enough for a model to fix them on its own.

## Decision

1. **Boundary rule:** if two models would produce the same output, the library
   does it (file shapes, ids, change ids, skill files); if it needs judgement, the
   agent does it. **The agent decides, the library writes**: decisions reach the
   library as command arguments.
2. **Flow:** the human runs `npx casefile init`, then `/casefile-setup` in their
   agent. The skill: reads `casefile spec setup` → explores the repo → asks the
   human once to confirm the plan → `casefile project add` per project → fills
   what the scaffold left pending → loops on `casefile validate --json` until it
   exits 0 (at most 5 rounds, then reports what is left) → offers `qa-bootstrap`
   per project → stops.
3. **Library commands for setup:**
   - `init` (human, a core operation): writes `casefile.yaml` (`version: 1`, `projects: []`) if
     absent and offers the shipped skills for `.claude/skills` / `.agents/skills`.
     Idempotent; never overwrites; never writes under `context/`.
   - `project add <name> <path>` (agent, a core operation): adds the project to
     `casefile.yaml` and scaffolds `<path>/context/tests/` with `_common.yaml`,
     `.runs/` and `.inbox/`. Re-running with the same arguments is a no-op; a
     conflicting name or path is an error.
   - `spec <topic>`: besides operation SPECs, core ships topic SPECs (`setup`,
     `commons`, `errors`) in `packages/core/specs/`.
   - `validate --json`: the oracle (point 5).
4. **Pending markers instead of defaults.** Scaffolded fields that need a
   decision hold the literal `TODO`, with a comment listing the allowed values.
   `validate` reports each as `scaffold.todo` (and not also as a schema error), so
   its output is the agent's task list. No default can slip in undecided.
5. **Error contract.** Every finding has `code` (stable, documented in
   `casefile spec errors`), `severity`, workspace-relative `path`, `line` and
   `field` when known, `message`, and `expected`, `hint`, `spec` when useful.
   Checks run in levels — workspace → file schemas → cross-file → resolution →
   environment — and a failing level stops the later ones for that scope, so a
   broken `casefile.yaml` yields one finding, not hundreds. Output order is
   deterministic. Exit: 0 clean, 1 findings, 2 no workspace.
6. **Ownership.** `casefile.yaml` is written by `init` (human) and by `project
   add` (agent); everything under `context/tests/` keeps its owner from
   write-ownership — the scaffold is written by an agent operation.

## Alternatives Considered

1. **Smart `init` that detects the layout and fills defaults** — per-toolchain
   heuristics to maintain, and defaults that look valid while being wrong (a
   mobile app with `surfaces: [web]`).
2. **The agent writes every file by hand from the SPEC** — no library code, but
   formats, ids and UUIDs are where models slip, and nothing is idempotent.
3. **Interactive wizard** — unusable by an agent and by CI.
4. **`init` also scaffolds commons** — a human would write files under
   `context/tests/`, breaking write-ownership; the agent has to decide their
   values anyway.

## Consequences

- Validator (#9) carries the error contract, the levels and `scaffold.todo`, with
  broken-workspace fixtures asserting exact codes.
- First real operations in the registry: `init` and `project add`.
- New SPEC `setup` and skill `casefile-setup`; `qa-bootstrap` runs per project.
- The deterministic parts are fully testable; the skill's "done" is objective
  (`validate` exits 0).
