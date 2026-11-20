# @casefile/web — local UI

The viewer of [casefile](https://github.com/albertomarturelo/testbed#readme).
A view of a casefile workspace for the human who follows what the agent
writes, and from #91 the host through which they write back (same origin +
session token; the commit is run as them, ADR identity-override): projects, feature tree, cases with their automation status and
latest run, a case's resolved values and where they come from, the query DSL,
and `validate` findings. ADR: [local-ui-stack](https://github.com/albertomarturelo/testbed/blob/main/docs/decisions/2026-10-17-local-ui-stack.md).

## Open it

You do not install this package by hand. `casefile init` pins it next to the
CLI in your repository's `.casefile/` directory, and the CLI starts it (ADR
[casefile-ui-command](https://github.com/albertomarturelo/testbed/blob/main/docs/decisions/2026-11-09-casefile-ui-command.md)):

```bash
.casefile/node_modules/.bin/casefile ui            # http://127.0.0.1:4321
.casefile/node_modules/.bin/casefile ui --port 5000
```

It is released together with `@casefile/cli` and `@casefile/core`, always at
the same version; `casefile ui` refuses a viewer of another version
(`ui.not_installed`). A workspace created before the viewer was published pins
only the CLI. Add it:

```bash
npm install --prefix .casefile --ignore-scripts --save-exact @casefile/web@<the CLI's version>
```

Without the npm registry, pin it in `.casefile/package.json` and unpack the
release's toolchain tarball (see the casefile README).

### From a clone of casefile

From the repository root:

```bash
pnpm build
pnpm ui --cwd examples/demo-monorepo
```

Then open <http://127.0.0.1:4321>. `--cwd` is any directory inside a workspace
(the one holding `casefile.yaml`); `--port <n>` changes the port. The server
listens on 127.0.0.1 only.

The UI reads the files on every request: edit a case and reload the page, or
press **Refresh**.

Developing the client with hot reload: run `pnpm ui --cwd <workspace>` in one
terminal and `pnpm --filter @casefile/web dev` in another; Vite proxies `/api`
to port 4321.

## How it works

- `src/server/` — a `node:http` host over `@casefile/core`. `POST
  /api/operations/<name>` runs a registry operation with the JSON body as input
  and answers the `Result` that `casefile <command> --json` prints. Reads are
  open to any local page. A writing operation runs only for the page itself:
  same origin (`Origin`, or `Sec-Fetch-Site: same-origin`) and the token that
  `GET /api/session` handed it, in the `x-casefile-token` header, never a URL.
  The server then commits the operation's files as the human — git's own
  identity, or `CASEFILE_USER_EMAIL` / `CASEFILE_USER_NAME` when set (ADR
  identity-override) — and answers `commit.sha`. Requests naming a host other
  than localhost are refused (DNS rebinding).
- Evidence (ADR [run-evidence-files](https://github.com/albertomarturelo/testbed/blob/main/docs/decisions/2026-11-20-run-evidence-files.md)
  §6–7). "Record a result" takes files dropped on it, picked, or pasted with
  Ctrl/Cmd+V (an image copied to the clipboard; text pasted into a field stays
  text), and links, each with an
  optional label. Each file goes up at once as `POST /api/evidence`: the raw
  bytes as the body, the name URI-encoded in `X-Casefile-Filename`, behind the
  same guard as a write. The server applies `casefile.yaml`'s `evidence` limits
  (size, extensions, never a script type), stages the file under the OS temp
  directory (never the repository) and answers
  `{ upload, name, size, kind }`. Past the size limit it stops reading,
  answers 413 and closes the connection; a body the client cuts off leaves
  nothing staged. Removing a file from the form sends
  `DELETE /api/evidence/<upload>` (same guard, idempotent). The page then sends `run` with
  `attach: [{ upload, label? } | { url, label? }]`; the server swaps each
  upload for its staged file before core copies it into
  `.runs/<run>/<case>/`. The page can never name a path on the machine
  (`ui.local_file`). An upload goes once a result names it, after an hour, or
  when the server stops (Ctrl-C included: the host removes them before it
  exits); a result core refuses keeps its uploads, so it can be
  sent again. The commit stages `run`'s evidence files with `git add -f`: they
  are committed even when the repository ignores e.g. `*.log`.
- `GET /api/evidence?ref=<workspace-relative path>` serves a stored evidence
  file read-only, open like every read: only a `ref` some run event names as a
  file `run` stored inside a `.runs/<run-id>/` directory, with an allowed,
  non-script extension, a regular file reached without a symlink. It reads
  only that ref's run file (`.runs/<run-id>.jsonl`), not the workspace. It answers
  with `Content-Type` from the extension, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`, and `Content-Disposition: attachment` except for
  images and videos. The run history shows images as thumbnails that open full
  size, videos, files to download and links that open in a new tab; the
  milestone page and its printable evidence link each case's evidence too.
- `src/client/` — React + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com/),
  built by Vite into `dist/client`. Views live in the URL hash
  (`#/cases?project=web&feature=login`, `#/case/web/TC-0001`, `#/query`,
  `#/validate`). Data comes from the `overview`, `resolve`, `query` and
  `validate` operations.

Host errors (the operation's own errors come back unchanged, with status 200):

| Code | Status | When |
|---|---|---|
| `ui.forbidden` | 403 | a writing operation asked from outside the page, or without the session token |
| `ui.commit_failed` | 500 | the files are written but git could not commit them; the message carries git's stderr |
| `ui.unknown_operation` | 404 | no operation has that name |
| `ui.not_found` | 404 | not `POST /api/operations/<name>` |
| `ui.invalid_input` | 400 | the body is not a JSON object, or is over 64 KiB; an upload without `X-Casefile-Filename` |
| `ui.local_file` | 400 | `run` from the page names a file on the machine (`evidence`, `attach[].file`) |
| `ui.upload_unknown` | 400 | `run` names an upload that does not exist, expired, or went with an earlier result |
| `evidence.too_large`, `evidence.type` | 413, 400 | an upload over `evidence.max_file_mb`, or of a type the workspace does not allow |
| `ui.evidence_not_found` | 404 | `GET /api/evidence` for a `ref` no run event names as a stored file, or that is not served |
| `ui.forbidden_host` | 403 | the `Host` header is not localhost |
| `ui.internal` | 500 | a bug: please report it |

Adding a shadcn component: see CONVENTIONS 13.
