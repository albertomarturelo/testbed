# The local UI is a Vite + React SPA on shadcn/ui, served by a Node host

## Status

Accepted — 2026-10-17 (#53). Amends [build-and-test-tooling](2026-10-15-build-and-test-tooling.md)
§1 (no bundler) for `apps/web` only.

## Context

The roadmap now builds the framework from a real case (#35) and puts the local UI
early, so a human sees what the agent produces while the flow is refined.
[apps-vs-packages](2026-10-15-apps-vs-packages.md) reserves `apps/web/` for it, but
nothing says how it is built, how it reaches core, or how it starts. The maintainer
fixed the design system: **shadcn/ui**, which implies React, Tailwind CSS and Radix
primitives, with components copied into the app rather than installed.

## Decision

1. **Shape:** `apps/web` (`@casefile/web`, `private`) has two parts.
   `src/server/` is a Node host over core, built with `tsc` like the other apps.
   `src/client/` is a React single-page app built by **Vite** into `dist/client/`.
2. **Server:** `node:http`, no framework. It binds to `127.0.0.1` only (`--port`,
   default `4321`), serves `dist/client/` with an SPA fallback, and exposes
   `POST /api/operations/<name>` with the operation's JSON input. The answer is
   the `Result` that `casefile <cmd> --json` prints. It is a generic host
   ([extension-model](2026-10-15-extension-model.md)): it calls `openRegistry`
   and has no operation logic. The actor is `human`. A writing operation runs only for a same-origin
   request carrying the session token, and the server then runs the returned
   commit as the human ([human-writes-through-operations](2026-10-19-human-writes-through-operations.md),
   #91; `ui.read_only` is gone). A request whose `Host`
   is not localhost is refused (DNS rebinding; added by #54).
3. **Freshness:** each request runs the operation, which loads the workspace from
   files ([files-are-source-of-truth](2026-10-15-files-are-source-of-truth.md)).
   There is no cache until the #26 index lands; the server then reads it instead.
4. **Client:** React + Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui. Components
   are added with the shadcn CLI at an exact version into
   `src/client/components/ui/`, committed, and owned as our code. `components.json`
   is committed. F1 has no router or state library. Views are selected by the URL
   hash and data comes from `fetch` on the API.
5. **Dependencies:** React, Tailwind, Radix and the other shadcn helpers are
   bundled into `dist/client`, so they are `devDependencies` of `@casefile/web`.
   Its only runtime dependency is `@casefile/core`. Bundled client libraries
   still count as shipped code for CONVENTIONS 10. Each one gets a row in STACK
   and a reason in its PR. A router, data or state framework needs an ADR.
6. **Bundler scope:** Vite builds only `apps/web/src/client`. Libraries, the CLI and
   the web server stay on `tsc`. `pnpm typecheck` covers the client with its own
   `tsconfig` (`jsx: react-jsx`, DOM lib, `noEmit`).
7. **Starting it (F1):** `apps/web` declares a bin `casefile-web` and the root has
   `pnpm ui --cwd <workspace>`. `pnpm --filter @casefile/web dev` runs Vite in
   dev mode and proxies `/api` to the server. The **`casefile ui` command is
   deferred** to the npm publishing decision. That decision already has to say how
   the CLI reaches `casefile mcp`, and the CLI may not depend on another app.
8. **Tests:** server API tests in Vitest (node) over the demo oracles. Client
   tests in Vitest with happy-dom and Testing Library (dev deps). Both run in
   the root Vitest `projects`.

## Alternatives Considered

- **Next.js** (shadcn's default) — routing, SSR and API routes included, but it
  brings its own server and build into a local CLI tool, much heavier to ship, and
  server code would live outside the generic-host rule.
- **React Router framework mode** — server loaders on Vite; more structure than F1
  views need, and loaders invite operation logic in the app.
- **Server-rendered HTML + htmx** — no bundler, but shadcn/ui is React-only.
- **Hono / Express / Fastify for the server** — nicer routing, but a runtime
  dependency (CONVENTIONS 10) for one static route and one API route.
- **`casefile ui` now through `.casefile/node_modules`** — the CLI would exec
  `@casefile/web` like version delegation. That forces web into every workspace's
  toolchain and complicates local development before anything is published.
- **Bundle the UI inside the `casefile` package** — one package, but it breaks
  app independence and grows the CLI for users who never open the UI.

## Consequences

- `apps/web` is the only workspace with a bundler. Upgrading Vite, React or
  Tailwind is a STACK PR like any other.
- The API is the registry as seen by the CLI `--json`. MCP (#15) can mirror it,
  and an extension's read-only operation appears in the API with no web changes.
- ARCHITECTURE and #54/#35 say `pnpm ui` until the publishing decision brings
  `casefile ui` back.
- Binding to `127.0.0.1` with no auth was safe only while the UI was read-only.
  Since #91 a write needs the request's `Origin` (or `Sec-Fetch-Site:
  same-origin`) and the token `GET /api/session` hands the page, never a URL;
  read-only operations stay open (ADR human-writes-through-operations §3).
