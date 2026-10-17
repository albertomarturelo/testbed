# @casefile/web — local UI

A read-only view of a casefile workspace, for the human who follows what the
agent writes: projects, feature tree, cases with their automation status and
latest run, a case's resolved values and where they come from, the query DSL,
and `validate` findings. ADR: [local-ui-stack](../../docs/decisions/2026-10-17-local-ui-stack.md).

## Open it

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

`casefile ui` arrives with the npm publishing decision (the CLI may not depend
on another app).

## How it works

- `src/server/` — a `node:http` host over `@casefile/core`. `POST
  /api/operations/<name>` runs a registry operation with the JSON body as input
  and answers the `Result` that `casefile <command> --json` prints. Operations
  that write are refused (`ui.read_only`); requests naming a host other than
  localhost are refused (DNS rebinding).
- `src/client/` — React + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com/),
  built by Vite into `dist/client`. Views live in the URL hash
  (`#/cases?project=web&feature=login`, `#/case/web/TC-0001`, `#/query`,
  `#/validate`). Data comes from the `overview`, `resolve`, `query` and
  `validate` operations.

Host errors (the operation's own errors come back unchanged, with status 200):

| Code | Status | When |
|---|---|---|
| `ui.read_only` | 403 | the operation writes files |
| `ui.unknown_operation` | 404 | no operation has that name |
| `ui.not_found` | 404 | not `POST /api/operations/<name>` |
| `ui.invalid_input` | 400 | the body is not a JSON object, or is over 64 KiB |
| `ui.forbidden_host` | 403 | the `Host` header is not localhost |
| `ui.internal` | 500 | a bug: please report it |

Adding a shadcn component: see CONVENTIONS 13.
