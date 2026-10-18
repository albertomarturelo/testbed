# Why a run ended: a bounded `note` on run events, attachments as evidence

## Status

Accepted — 2026-10-17 (#68). Extends [ingester-contract](2026-10-17-ingester-contract.md)
§1 and §9 and the run-event schema.

## Context

The first real case (#35) ingested three Playwright failures, and the UI could
only say `failed`. Each cause was in the JUnit report and was lost on ingest:
a Cloudflare challenge page for one, and a disabled button and an unexpected
attribute value for the other two (#76). ingester-contract left failure messages out because
a run event had no field for them, and attachments for "when the UI needs
them". The UI now shows a case's run history (#68), and each failed run needs
its reason next to it. A report's failure text can be a full stack trace or call
log, and every event is one line of an append-only JSONL file kept in Git.

## Decision

1. **`note` on a run event:** optional text, 1–2000 characters, what the
   executor said about the result (a failure message, a human's remark when the
   `run` operation lands). `NOTE_MAX = 2000` is exported by core. Schema-first:
   the Zod schema and the committed JSON Schema both carry the bound.
2. **Ingesters pass it unbounded:** `IngestedResult.note` has no maximum. Core
   cuts it to `NOTE_MAX` characters, the last one `…`, when it builds the event,
   so no format has to know the bound and an extension cannot fail the schema
   by a long message.
3. **Merging (ingester-contract §9):** the merged note is the distinct notes of
   the results that have the merged status, in report order, joined by a blank
   line, then cut. A pass in chromium adds nothing to a failure in firefox.
4. **JUnit:** the note is the text of the `failure` or `error` element (the
   runner's whole message: Playwright's error and call log, Surefire's stack
   trace), with blank edge lines removed and the common indentation stripped;
   without text, its `message` attribute. `skipped` and passes carry no note.
5. **Attachments as evidence:** a `[[ATTACHMENT|<path>]]` line in the test's
   `system-out` (Playwright) becomes `{ kind: "attachment", ref: <path> }`, in
   report order: a relative path resolved from the report's directory to a
   workspace-relative one, an absolute path kept as written. Evidence stays references; casefile never reads the file.
6. **Idempotency (ingester-contract §6) is unchanged:** the note and evidence
   are part of the event. A report ingested before this change, ingested again,
   appends its failed events once more with their notes; the earlier lines stay
   (CONVENTIONS 5), and the latest event per case is the noted one.
7. **Reading runs:** a read-only `runs <ref>` operation lists one case's events,
   newest first, each with its run file, for the UI's case detail and the CLI.

## Alternatives Considered

1. **The message as evidence** (`{ kind: "failure", ref: <text> }`, no schema
   change) — `ref` points at an artifact everywhere else; a message there would
   be the one evidence entry that is not a reference.
2. **Only the `message` attribute** — short, but older Playwright writes the
   test's location there, and the cause (`element(s) not found`) is in the text.
3. **The whole failure text, unbounded** — a call log can reach tens of
   kilobytes on one JSONL line, repeated in every run, in Git forever.
4. **Bounding in each ingester** — every format repeats it, and an extension
   that forgets fails the run-event schema instead of being cut.
5. **Runs inside `resolve`** — `resolve` answers what a case is after
   inheritance; runs are a separate read the CLI also wants on its own
   (`casefile runs TC-0002`), and the UI can load them independently.
6. **A note per Playwright project in evidence** — evidence would hold prose
   again (1); the joined note keeps each project's text, which Playwright
   already starts with `[<project>] ›`.

## Consequences

- Run files written before #68 stay valid; a re-ingest adds the noted events.
- Attachment files stay where the runner wrote them, usually untracked: in a
  fresh clone the evidence path can point at nothing. Shipping them is #70's
  question (how CI's run files reach the repository).
- Absolute paths in a runner's message (a stack frame) are copied into the
  note as written; casefile does not rewrite report text.
- The human `run` operation will reuse `note` for the tester's remark.
