# casefile commits follow the host repository's conventions

## Status

Accepted — 2026-11-12 (#157, for #151, #102, #103). Amends
[agent-runs-the-commit](2026-10-17-agent-runs-the-commit.md) §1 (the subject
comes from a template; `Agent:` can be turned off) and
[git-is-identity](2026-10-15-git-is-identity.md) (its trailer list). Subjects
quoted in other ADRs and SPECs become examples of the default.

## Context

Every commit casefile hands back has a fixed subject (`cover(login): propose 3
cases`, `review(login): approve TC-0003`, `run(…)`, `ingest(…)`, `setup: …`)
and, for an agent, an `Agent: <name>` trailer. Trials on real repositories hit
three rules that reject them: a ticket key first in the subject for the issue
tracker's smart commits (`[PROJ-123] type(scope): …`, #151, where the viewer
commits for the QA and the subject cannot be changed), Conventional Commits
enforced by commitlint, where `cover`/`review`/`setup` are not types (#103), and
no AI tool named in commits (#102). A repository's commit rules are not
casefile's to change, and rewriting history afterwards is no answer.

## Decision

1. **A `commit` section in `casefile.yaml`**, workspace-wide (one repository,
   one convention), every key optional:

   ```yaml
   commit:
     subject: "[{ticket}] {type}({scope}): {summary}"
     ticket_from_branch: "([A-Z][A-Z0-9]+-[0-9]+)"
     ticket_default: NO-TICKET
     agent_trailer: false
   ```

2. **The subject is a template** with four placeholders, filled by core:
   - `{type}`: `test` for case and run files, `chore` for the setup commit;
   - `{scope}`: the feature (`cover`, `review`, `run`), the project (`ingest`),
     `casefile` (setup);
   - `{summary}`: what follows the colon today (`propose 3 cases`,
     `edit and approve TC-0003`, `record TC-0002 as passed`, `record run 9138`,
     `register web`);
   - `{ticket}`: see 3.

   The default is **`{type}({scope}): {summary}`**, Conventional Commits:
   `test(login): propose 3 cases`. One template serves every commit casefile
   hands back: agent, viewer and CI. The validator refuses a template without
   `{summary}` or with an unknown placeholder (`config.commit_subject`).
3. **The ticket**, only when the template names `{ticket}`: the `ticket` input
   of the writing operation (`--ticket` in the CLI, a field in the viewer), else
   the current branch matched by `ticket_from_branch` (first capture group, else
   the whole match; the branch is a host input filled like `identity`), else
   `ticket_default`. None of them → `commit.ticket_missing` and nothing is
   written. A ticket is one token (letters, digits, `._#/-`), else
   `commit.ticket_invalid`; a ticket given to a template without `{ticket}` is
   `commit.ticket_unused`. The viewer shows the field only when the template
   names `{ticket}`, prefilled from the branch, and keeps what the QA typed
   for the browser session.
4. **The viewer keeps committing for the QA** (ADR
   human-writes-through-operations §2), now with the repository's subject.
5. **`agent_trailer: false`** drops the `Agent:` line, and `--agent` becomes
   optional for the agent (a name given is not written). The author
   `casefile-agent`, `Requested-by:` and `Casefile-Change:` stay: the
   ownership audit (#41) tells agent commits apart by author and trailers,
   never by subject or `Agent:`.
6. **Never templated:** the other trailers, the authors, one change id per
   call and the pathspec. They are casefile's contract, not a style.
7. **Setup reads the rules:** the setup SPEC has the agent look for
   commitlint, `.gitmessage`, PR-title checks and CONTRIBUTING, and propose
   the `commit` values in its one plan.
8. **Ships in `0.2.0`:** the new default changes the subject every writing
   operation returns, a breaking output change under ADR release-process §2.

## Alternatives Considered

1. **A viewer that does not commit** (`--no-commit`): the QA copies the
   message by hand, and a lost `Casefile-Change:` silently unlinks `history`
   from its commit. Not built until a repository forbids tool-made commits.
2. **Leave it to Git hooks** (`prepare-commit-msg` adding the key): every
   repository writes and installs one, commitlint still rejects
   `cover(…)`, and the agent's and CI's commits depend on local setup.
3. **The caller writes the subject** (`--subject`): agents slip on formats
   (ADR agent-driven-setup), the QA would type it on every write, nothing
   checks it. The template gives that freedom, decided once.
4. **Keep today's subjects as the default:** commitlint's default config
   rejects them, so Conventional repositories fail until someone finds the
   setting. A `0.x` minor is the cheap moment to change it.
5. **A template per project:** one repository has one commit convention.

## Consequences

- Implementation, one session each: core (`commit` config, subject template,
  ticket resolution, `agent_trailer`, every operation and SPEC; #103 + #102),
  then the viewer's ticket field and the CLI's `--ticket` (#151), then the
  setup SPEC, `casefile-setup` and the `qa-*` skills (what to do when
  `Agent:` is off or a ticket is required).
- Existing commits keep their subjects; nothing parses a subject for meaning.
- With `{ticket}` in the template, CI's record job needs `ticket_default` or
  `--ticket`. Run events' `executor` is file content: out of scope.
