# Inbox directory name: truncated SHA-256 of the normalized email

## Status

Accepted — 2026-10-15 (#3)

## Context

Intents live in `context/tests/.inbox/<email-hash>/<id>.yaml`; the brief does not
define the hash. The per-user directory exists so that two humans writing
intents on different branches never touch the same paths (no merge conflicts).
It is **not** a privacy measure: the item's `by` field and the commit author
already contain the email.

## Decision

`<email-hash>` = first **12 hex characters** of `sha256(lowercase(trim(email)))`,
where `email` is `git config user.email`.

- Computed with `node:crypto`, no dependency.
- `casefile validate` checks that each item's directory equals the hash of its `by`.
- 12 hex chars = 48 bits: a collision inside one repo's team is negligible, and
  `validate` reports it if it ever happens (two different `by` in one directory).

## Alternatives Considered

- **The email itself as directory name** — readable, but `@`, `+` and case
  differences make it fragile across filesystems and Git configurations.
- **Slug of the email** (`ana-example-com`) — readable, but lossy: different
  emails can map to the same slug with no way to detect it from the name.
- **Full 64-char hash** — no practical gain; long paths on Windows.
- **No per-user directory** (flat `.inbox/`) — more merge conflicts between humans.

## Consequences

- `core` exposes `inboxDir(email)`; the web UI and CLI use it, never their own logic.
- Lowercasing means `Ana@x.com` and `ana@x.com` are one person, matching how
  Git hosting providers treat emails.
