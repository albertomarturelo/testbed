# Agent is the sole writer of test files

## Status

Accepted — 2026-10-15 (from the founding brief)

## Context

The human QA should orchestrate, not hand-edit YAML/Markdown; mixing writers makes provenance unclear.

## Decision

Only the agent writes files under `context/tests/`, operating through scoped skills. Humans express intents via `.inbox`. Agent-created cases start as `state: draft`; review policy (`review.mode: required | post_hoc | auto`) lives in commons per subtree.

## Alternatives Considered

- **Humans edit files directly** — still possible in Git, but not a supported workflow.
- **UI writes case files** — turns the UI into a second writer with its own validation path.

## Consequences

- Every change is attributable to an intent.
- Open conflict: CI writing `.runs/` and the system flipping `automation.status` (see #1).
