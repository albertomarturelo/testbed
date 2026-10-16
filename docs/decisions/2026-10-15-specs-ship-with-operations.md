# Operation SPECs ship with the operation and are read through the CLI

## Status

Accepted — 2026-10-15 (#3). Extended by
[agent-driven-setup](2026-10-15-agent-driven-setup.md): core also ships topic SPECs
(`setup`, `commons`, `errors`), read with the same `casefile spec <topic>`.

## Context

The brief put SPECs in `context/specs/` of this repo. Two constraints since then:
this repo's own context is in `docs/` (CFD), and
[extension-model](2026-10-15-extension-model.md) declares `spec` on each
operation, so an external operation's SPEC must live in its own package.
Skills run inside **user** repos, where this repo's files do not exist; they
need a way to read the SPEC they cite.

## Decision

- A SPEC lives **next to the operation that owns it** and ships in the same npm
  package: built-ins in `packages/core/specs/<op>.md`, extensions in their package.
- `defineOperation({ spec })` is a path relative to the declaring package.
- **`casefile spec <op>`** prints the SPEC of any registered operation; the MCP
  host exposes the same text as a resource.
- Skills cite SPECs as "run `casefile spec cover`", never by file path.
- `casefile spec <op>` is part of the F0 CLI (#11); stubs print their SPEC this way.

## Alternatives Considered

- **`specs/` at the root of this repo** (proposal in CURRENT_STATUS) — not
  shipped to users, so skills could not read them; external operations would
  have their SPECs elsewhere.
- **`context/specs/` (brief)** — collides with this repo's CFD layout and with
  the product meaning of `context/`.
- **Copy SPECs into the user repo on `init`** — copies drift from the installed
  version.

## Consequences

- #12/#13 write to `packages/core/specs/`.
- #14 skills reference `casefile spec <op>`.
- The SPEC a user reads always matches the installed casefile version.
