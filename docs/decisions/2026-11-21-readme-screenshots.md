# The README shows the viewer in screenshots a script regenerates

## Status

Accepted — 2026-11-21 (#223, shipped with #222). Applies
[local-ui-stack](2026-10-17-local-ui-stack.md) and CONVENTIONS 14 (the Playwright of
`examples/npm-login` drives the viewer); touches [release-process](2026-10-20-release-process.md)
only in that the README is the npm page of `@casefile/cli`.

## Context

The README describes the local UI in words only: a reader cannot see the viewer before
installing it. Screenshots fix that, but screenshots taken by hand go stale with the
next change to a view, and nobody remembers how they were taken (which workspace,
which size, whose identity on screen). The README is also the npm page of
`@casefile/cli`, published from `apps/cli`, so an image must render there too.

## Decision

1. **A script takes them.** `scripts/screenshots.mjs` (root script `pnpm screenshots`,
   after `pnpm build`) starts `apps/web/dist/server/bin.js` on `examples/demo-repo` at
   a free port, opens each view in headless Chromium, waits for it to render, saves a
   PNG, and stops the server with SIGTERM, like `scripts/smoke-ui.mjs`. A view that
   does not render, or a page error, fails the script and writes nothing for it.
2. **Fixed inputs, so a re-run changes nothing a reader sees.** Data: the committed
   `examples/demo-repo` (one project, runs, the open milestone `web-1.2.0`, two
   dashboards). Viewport 1280×800 at device scale 1, light theme, reduced motion,
   sidebar expanded. Identity: `CASEFILE_USER_EMAIL=qa@acme.example` and
   `CASEFILE_USER_NAME="QA Lead"`, never the git identity of whoever runs it. The one
   thing that moves is the dashboard's "computed on" date: it is the day of the run.
3. **The views.** A dashboard, the case list, a case in its Sheet, a query with
   results and a milestone: what a reader needs to picture the viewer. Validate (one
   line, "Valid") and the printable evidence (the milestone page again, above the fold)
   add nothing at this size. A view added or redesigned in a way the README should show
   gets a line in the script.
4. **Where they live.** `docs/screenshots/<view>.png`, committed. The README links them
   with absolute `https://raw.githubusercontent.com/albertomarturelo/testbed/main/docs/screenshots/…`
   URLs: a relative path resolves against `apps/cli` on npm and breaks there.
5. **Browser.** The Playwright installed in `examples/npm-login` (`npm ci` there and
   `npx playwright install chromium` once), as CONVENTIONS 14 does for viewer checks.
   The script says so and exits when it is missing. No new dependency in the monorepo.
6. **When to regenerate.** A PR that visibly changes a captured view runs
   `pnpm screenshots` and commits the PNGs that changed (CONVENTIONS). CI does not run it.

## Alternatives Considered

1. **Screenshots taken by hand** — no script to keep, but they go stale silently, the
   next person cannot reproduce them, and they leak whoever took them (email, local
   data) into the README.
2. **`playwright` as a root devDependency** — the script would not depend on an
   example's install, but CONVENTIONS 10 asks for minimal dependencies and 14 already
   settled on the example's Playwright for driving the viewer; one place, one version.
3. **Relative image paths** — render on GitHub, break on the npm page (the package is
   `apps/cli`). Absolute URLs to `main` render on both; an old npm version then shows
   today's viewer, which is acceptable for a picture of the UI.
4. **A CI job that regenerates and commits them** — never stale, but a bot commit on
   every UI PR, browsers in CI and pixel noise between runners for a documentation asset.
5. **2x images (device scale 2)** — sharper on HiDPI screens, ~4 times the bytes on every
   regeneration, kept forever in Git history.
6. **Light and dark (`<picture>`)** — the viewer has no theme switch yet; dark is forced
   only in tests and has known faint spots. Revisit when a theme switch lands.

## Consequences

- The README shows the viewer; `docs/screenshots/` grows by a few hundred KB per
  regeneration in Git history, which is why 1x and "only when a view changes".
- Images on `main` can run ahead of the npm version a reader installed.
- `examples/demo-repo` is now also the README's stage: changing its data changes the
  screenshots on the next run.
