# A recorded result carries evidence: files kept in the repository, and links

## Status

Accepted — 2026-11-20 (#201). Amends [run-event-note](2026-10-17-run-event-note.md)
§5 (casefile now reads and copies the files a `run` attaches; ingest keeps
references) and [write-ownership](2026-10-15-write-ownership.md) (`run` writes
evidence directories under `.runs/`).

## Context

A run event can carry `evidence: [{ kind, ref, sha256? }]`, but only `ingest`
fills it, with paths to Playwright attachments that usually stay untracked: in
a clone and in a milestone's frozen `evidence.md` they point at nothing. A QA
or an agent recording a result cannot attach anything: `run` and "Record a
result" take a status and a note (tried on `examples/npm-login`, 2026-11-20).
The maintainer wants images, files and links on an execution, the files kept
in an internal structure of the repository.

## Decision

1. **Two shapes of evidence.** A **file** (screenshot, short video, log, HAR,
   PDF) is copied into the repository; a **link** (an issue, a recording, a
   dashboard, a CI build) is kept as its URL and never fetched.
2. **Where files live:** next to the run file they belong to,
   `<project>/context/tests/.runs/<run-id>/<case-id>/<sha8>-<name>`. `sha8` is
   the first 8 hex digits of the file's SHA-256; `name` is the original base
   name, lower-cased, reduced to `[a-z0-9._-]`, at most 60 characters. A file
   is never overwritten; the same content is written once.
3. **The event references them:** `{ kind, ref, sha256, label? }`. For a file,
   `kind` is `image`, `video` or `file` (from the extension), `ref` the
   workspace-relative path, `sha256` required. For a link, `kind` is `link`,
   `ref` the URL (`https:` or `http:` only), no `sha256`; the schema keeps
   `sha256` optional, `run` and `validate` enforce it per kind. `label`: new,
   optional, 1–120 characters. Ingest's `attachment` refs stay valid.
4. **Limits, set per workspace in `casefile.yaml`, checked by core before
   anything is written:** `evidence.max_file_mb` per file (default 10) and
   `evidence.extensions`, which replaces the default list `png jpg jpeg gif
   webp mp4 webm pdf txt log json har`; at most 20 entries per event. Types a
   browser runs as script (`svg htm html xhtml xml js mjs`) are refused even
   if listed, since the viewer would render them; the validator flags them in
   the config (`config.evidence_extension`). Errors: `evidence.too_large`,
   `evidence.type`, `evidence.too_many`, `evidence.link`, `evidence.not_found`.
5. **Attached when the result is recorded.** `run` takes
   `evidence: [{ file, label? } | { url, label? }]`; the CLI spells it
   `--evidence <path>` and `--link <url>`, repeatable, with an optional
   `label` through the JSON input. Core copies and hashes the files and lists
   them in the files it returns, so one commit (ADR agent-runs-the-commit)
   carries the event and its evidence. Adding evidence later means recording
   the result again.
6. **The viewer uploads through its own endpoint.** Operation bodies stay
   small JSON (64 KB). `POST /api/evidence` takes one file as the raw body,
   its name in `X-Casefile-Filename`, behind the write guard of
   human-writes-through-operations §3, applies point 4, stages it under the
   OS temp dir (never the repository) and returns an upload id; `run` names
   `{ upload: <id> }` and the server swaps in the staged path before core sees
   it. Staged files go when the run is recorded or the server stops. "Record a
   result" takes dropped, picked and pasted (Ctrl/Cmd+V) files, and links.
7. **The viewer serves stored evidence read-only:** `GET /api/evidence?ref=`
   answers only for a `ref` that a run event names, inside a
   `.runs/<run-id>/` directory, never a script type; `Content-Type`
   from the extension, `X-Content-Type-Options: nosniff`, and
   `Content-Disposition: attachment` for everything but images and video. The
   run history shows thumbnails that open full size, links that open in a new
   tab (`rel="noopener noreferrer"`), and files to download.
8. **Git LFS is the host repository's business**, not casefile's: it writes
   plain files, and a `.gitattributes` routing images to LFS applies on add.
9. **Validate:** a stored file missing, or not matching its `sha256`, is an
   error (`evidence.missing`, `evidence.changed`); links and ingest refs aren't.

## Alternatives Considered

1. **References only, as today** — nothing to store, but a clone, a reviewer
   and a frozen milestone see paths to nothing; the evidence is lost.
2. **A content-addressed store** (`context/evidence/<sha256>`) — deduplicates
   across runs, but nobody can tell which screenshot belongs to which case and
   execution without casefile, and a repeated screenshot is rare.
3. **External storage** (S3, Drive) with a URL in `ref` — keeps the repository
   light, but a second source of truth (ADR files-are-source-of-truth),
   credentials in every host, and evidence that disappears with an account.
4. **An "evidence added" event, to attach after the fact** — run files are
   append-only and the latest event per case counts; a second event type
   changes what every reader of `.runs/` expects. Recording the result again
   says the same. Revisit if QAs ask for it.
5. **Base64 in the operation's JSON, or multipart** — base64 grows a file by
   a third and lifts the 64 KB limit for every operation; multipart needs a
   parser dependency. A raw body per file needs neither.

## Consequences

- The repo grows with every file; the cap is the brake. Long videos go as links.
- `run`'s SPEC, the run-event schema (`label`) and the `casefile.yaml` schema
  (`evidence.max_file_mb`, `evidence.extensions`) change: a minor release.
- A milestone's `evidence.md` lists `ref`s that exist in every clone.
- Ingest keeps references; copying Playwright attachments in is a later question.
- Implementation, one session each, in order: #203 core + CLI (schema, limits,
  copy, `run --evidence/--link`, validate, SPEC); #204 viewer (upload endpoint,
  "Record a result", serving, run history). The `qa-run` skill (#14, not
  written yet) attaches the agent's screenshots and links.
