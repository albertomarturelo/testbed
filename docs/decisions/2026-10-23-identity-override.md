# The person's identity: flag, then `CASEFILE_USER_EMAIL`, then git config

## Status

Accepted — 2026-10-23 (#108). Amends [git-is-identity](2026-10-15-git-is-identity.md)
(a human is their `git config user.email`, nothing overrides it) and
[human-writes-through-operations](2026-10-19-human-writes-through-operations.md)
§2 (the viewer commits with the user's git identity, never `-c user.*`).
[agent-runs-the-commit](2026-10-17-agent-runs-the-commit.md) is unchanged.

## Context

A trial of casefile 0.1.0 on a real repository (#108): every `history[].by`
and `Requested-by:` came out as the machine's GitHub email, with no way to
change it short of editing git config. That identity is not always the QA's: a
QA on a shared or borrowed machine, a work email different from the GitHub
one, a QA who never configured git, several people driving one checkout. The
skills pass `$(git config user.email)` as `--requested-by` themselves, and the
viewer's write path (#91) was specified to commit with git's identity only, so
the gap would ship into the human path too.

## Decision

1. **Precedence.** The person's identity is resolved in this order, first hit
   wins: an explicit input (`--requested-by`, or the host's own flag), then the
   environment `CASEFILE_USER_EMAIL` (+ optional `CASEFILE_USER_NAME`), then
   `git config user.email` / `user.name`. None → `identity.missing`, as today.
2. **One resolver in core, values read by the host.** Core exposes a pure
   `resolveIdentity({ explicit?, env?, git? })` returning
   `{ email, name?, source: "explicit" | "env" | "git" }`. Core reads no
   environment ([cli-generic-host](2026-10-17-cli-generic-host.md) §3): each
   host (CLI, viewer server, MCP) reads the env and `gitUserEmail` and passes
   them in. A malformed email is a typed error `identity.invalid` with a hint
   naming the source, never a throw.
3. **`identity` is the resolved value.** The host input `identity` carries
   the resolved email, so `cover` defaults `requestedBy` to it and the skills
   stop calling `git config`. `history[].by` is that email.
4. **The viewer commits as the resolved identity.** When the source is `env`
   (or `explicit`), the server commits with
   `-c user.name=<name> -c user.email=<email>`; when it is `git`, with git's own
   identity and no `-c`. The page shows who the QA is acting as (email and
   source) wherever it offers a write.
5. **The identity is visible before writing.** Hosts expose
   `{ email, name, source }`: the CLI as `casefile whoami` (`--json` too), the
   viewer in its header. `source` is what tells a QA that a wrong identity
   comes from a stale env var and not from git.
6. **Why `CASEFILE_*` and not git's own variables.** `GIT_AUTHOR_EMAIL` /
   `GIT_COMMITTER_EMAIL` would be honoured by git already, but they change
   every other commit made in that shell; `CASEFILE_USER_EMAIL` touches only
   what casefile writes, which is the whole point of a casefile-scoped override.

## Alternatives Considered

1. **Keep git config as the only identity** — the trial showed the only way
   to appear as someone else is editing the checkout's git config, which also
   changes the person's product commits. Rejected.
2. **Use `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL`** — shell-wide side
   effect on every commit (see Decision 6); and casefile would still need to
   read them to fill `history[].by`, so nothing is saved. Rejected.
3. **An identity setting in `casefile.yaml` or `.casefile/`** — `casefile.yaml`
   is shared and committed, identity is per person; an untracked local file is
   a second identity store beside git's, with its own lifecycle. Rejected.
4. **The viewer asks for the identity in the page** — equally spoofable,
   needs storage per browser, and the value must match the commit the server
   makes. Not needed while the env var covers the shared-machine case; can be
   added over the same resolver later.
5. **Accounts / login** — ruled out by git-is-identity; unchanged.

## Consequences

- git-is-identity reads: a human is the email casefile resolves (flag, env,
  git config). Its spoofability consequence holds: the env var is as
  spoofable as git config, and trust-critical actions still need signatures.
- human-writes-through-operations §2 reads: the viewer commits as the
  resolved identity, `-c user.*` only when an override is set. #91's
  acceptance criteria are updated to this; the server fills `identity` with
  the resolved email and `via` with `ui:<operation>`.
- #108 implements: resolver + tests for the precedence (flag over env over
  git; env set with git unconfigured; invalid email), `whoami`, the `cover`
  default, skills and SPECs (`setup`, `cover`) no longer calling `git config`.
- The write-ownership audit (#41) keeps reading authors: a human commit's
  author equals its `Requested-by:`, whichever source produced it.
- Agent commits are unchanged: author `casefile-agent`, `Requested-by:` the
  resolved identity.
