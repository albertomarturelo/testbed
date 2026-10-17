# How result ingesters plug in and what they write

## Status

Accepted — 2026-10-17 (#17). Refines the Ingester row of
[extension-model](2026-10-15-extension-model.md); applies
[write-ownership](2026-10-15-write-ownership.md) to `.runs/`.

## Context

CI must turn a test report (JUnit first; CTRF and Allure in #57) into run
events in `<project>/context/tests/.runs/<run-id>.jsonl`, matched to cases by
`automation.ref`. extension-model sketches an ingester as `parse(bytes) →
RunEvent[]`, but a `RunEvent` needs a `case_id`, a `run_id` and an `executor`
that the report does not hold. If every ingester matched cases and wrote files
itself, each format would reimplement matching, unmatched reporting and
idempotency, and could get write ownership wrong. The CLI is a generic host
([cli-generic-host](2026-10-17-cli-generic-host.md)): it renders operations, not
ingesters. JUnit is XML, and core has no XML parser (CONVENTIONS 10).

## Decision

1. **An ingester only parses.** `defineIngester({ format, spec, parse })`;
   `parse(text, { path })` returns `Result<IngestedResult[]>`: one result per
   test, keyed by `ref` (the `automation.ref` it would match) with `status` and
   optional `at`, `duration_ms`, `evidence`. Report text is UTF-8 (every target
   format is text). Errors are values with line and column.
2. **Core does the rest, the same for every format.** `ingestOperation(ingester)`
   makes the operation `ingest-<format>` (CLI `casefile ingest <format> <report>`):
   it reads the report (workspace-relative, through the guarded context),
   validates every result, matches refs against the project's cases, builds
   `RunEvent`s and validates them against the run-event schema, and appends them
   to the run file. It writes only `**/context/tests/.runs/*.jsonl`.
3. **Registration:** built-in ingesters are in `builtinOperations` through
   `ingestOperation`; an extension lists them in `manifest.ingesters` and the
   host registers them the same way. A new format needs no core change; a
   format already registered is `operation.duplicate`.
4. **Who may ingest:** actors `ci` and `agent`, and the `executor` prefix must
   be the actor (`ci:*` / `agent:*`). A human run goes through the `run`
   operation; an ingested event is what proves `automated`.
5. **Unmatched results are output, not events:** a result whose ref is on no
   case is listed in `unmatched` with its status; a ref on several cases gives
   one event per case.
6. **Idempotent by content:** events already in the run file, compared without
   `at` and counted as a multiset, are not written again; new ones are appended
   after the existing lines, which stay byte for byte. Ingesting the same report
   twice writes nothing; a second shard into the same run id adds its events.
   `at` is the report's timestamp when it carries a time zone, else the
   ingestion time.
7. **JUnit ref:** `<classname>::<name>` of the `testcase` (the suite name when
   `classname` is missing). For Playwright this is `<test file>::<title path>`,
   e.g. `login.spec.ts::rejects an empty password`; titles inside `describe`
   blocks keep Playwright's ` › ` separator.
8. **No XML dependency:** core reads XML with a small hand-written reader
   (elements, attributes, text, CDATA, comments, the five predefined entities
   and character references). A `DOCTYPE` is refused, so no entity expansion
   and no external fetches.

## Alternatives Considered

- **`parse` returns `RunEvent[]` (the extension-model sketch)** — every format
  would match cases and dedupe; unmatched results would depend on each author.
- **One `ingest` operation with a `--format` flag** — the CLI form in #17 is
  `ingest junit <file>`, and an extension format would need the core operation
  to know it at schema time.
- **An XML library** (`fast-xml-parser`, `sax`, `@xmldom/xmldom`) — a runtime
  dependency (and a history of prototype-pollution / entity CVEs in the space)
  for the small subset JUnit uses.
- **Idempotency by run file existence** (refuse if `.runs/<run>.jsonl` exists) —
  simplest, but breaks sharded runs that report under one run id.
- **Report path relative to `--cwd`** — needs a new kind of host input; paths
  are workspace-relative elsewhere (workspace-and-projects §7).

## Consequences

- `ExtensionManifest` gains `ingesters`; the extension-model row reads
  `parse(text, ctx) → IngestedResult[]`.
- A report outside the workspace is `path.outside_workspace`: CI copies it in.
- The operation makes no commit: CI commits `.runs/` (or ships it) itself.
- Failure messages and attachments are not mapped yet (no event field for the
  first; evidence for the second can come with the UI's need).
