# `casefile ui` runs the viewer installed next to the CLI

## Status

Accepted — 2026-11-09 (#113). Settles what
[local-ui-stack](2026-10-17-local-ui-stack.md) §7 deferred and
[npm-scope-casefile](2026-10-17-npm-scope-casefile.md) §1 left open. Amends
[release-process](2026-10-20-release-process.md) §1 (three packages),
[casefile-toolchain-dir](2026-10-15-casefile-toolchain-dir.md) §2 (`init` pins two)
and [release-toolchain-tarball](2026-11-09-release-toolchain-tarball.md) §1, §6
(the tarball carries the viewer).

## Context

The viewer only starts from a clone of the casefile repository
(`pnpm ui --cwd <workspace>`), which needs `pnpm install`, so the npm registry.
A product repository that installed casefile in `.casefile/`, by npm or from
the tarball, cannot open it. For a team that keeps cases as documentation the
viewer is the product ([authoring-loop-first](2026-10-19-authoring-loop-first.md)),
and the maintainer's company has no registry at all.
[apps-vs-packages](2026-10-15-apps-vs-packages.md) forbids an app depending on
another app, so the CLI cannot simply import `@casefile/web`.

## Decision

1. **`@casefile/web` is published**, in lockstep with `@casefile/core` and
   `@casefile/cli` (one version, core pinned exactly). It ships `dist/`
   (server and built client), a README and the LICENSE; its only runtime
   dependency stays `@casefile/core`. Its bin stays `casefile-web`.
2. **`init` pins both** `@casefile/cli` and `@casefile/web` at the running
   version in `.casefile/package.json`. The viewer is installed by default, on
   both channels: the toolchain tarball carries it too, so npm and the tarball
   still lay out the same files.
3. **`casefile ui [--port <n>]` is a host command of the CLI** (like `spec`
   and `whoami`: [cli-generic-host](2026-10-17-cli-generic-host.md) §1), not an
   operation. It finds the workspace from `--cwd`, reads
   `.casefile/node_modules/@casefile/web/package.json`, and runs that package's
   `casefile-web` bin as a child process with the same Node, stdio and
   environment, passing `--cwd <workspace root>` and `--port`. It exits with
   the child's status and forwards `SIGINT`/`SIGTERM`. The server still binds
   to `127.0.0.1`.
4. **The CLI never imports or depends on `@casefile/web`.** It reaches it the
   way version delegation reaches the pinned CLI: a package found in the
   toolchain directory, executed. apps-vs-packages rule 1 stands as written
   and `scripts/check-boundaries.mjs` keeps enforcing it. Only `casefile ui`
   needs the viewer; every other command runs without it.
5. **Version and errors.** `casefile ui` goes through version delegation
   first, so the pinned CLI is the one that looks. The viewer must be
   installed at the CLI's own version; otherwise the command fails with
   `ui.not_installed` (missing, a different version, or no `casefile-web` bin)
   and a hint with both fixes: `npm install --prefix .casefile
   --ignore-scripts --save-exact @casefile/web@<version>`, or add the pin and
   unpack the release tarball. Outside a workspace it fails as any command
   does. `validate` does not check the viewer: a workspace may drop the pin
   (CI images), and only `casefile ui` cares.
6. **Workspaces created before this** pin only the CLI: `casefile ui` there
   answers `ui.not_installed` with the hint. Nothing migrates them silently.
7. **From source:** `pnpm ui` stays for developing casefile, and
   `scripts/link-toolchain.mjs` also links `@casefile/web`, so `casefile ui`
   works in the examples.
8. **Release:** `scripts/release.mjs` sets and checks three versions; the
   workflow packs, smoke-tests and publishes core, web, then the CLI. The smoke
   test starts `casefile ui --port 0` from the installed toolchain (npm layout
   and tarball) and fetches the page and one API call.
9. **`casefile mcp`** will follow the same shape when the MCP server exists
   (#15): its own published package, executed by a host command. Whether
   `init` pins it by default is decided then.

## Alternatives Considered

1. **Ship the built viewer inside `@casefile/cli`** — one package and
   `casefile ui` always works, but the CLI would load another app's code
   (amending apps-vs-packages), every CLI install grows, and local-ui-stack
   already rejected it.
2. **`@casefile/cli` depends on `@casefile/web`** — npm installs it with no
   second pin, but it is exactly the app-to-app dependency rule 1 forbids, and
   CI images could never leave the viewer out.
3. **Move the server into a shared `packages/` library** — no child process
   and no app-to-app question, but it moves the server and its tests, adds a
   fourth published package, and does not fit the issue's two sessions.
4. **No `casefile ui`: document `.casefile/node_modules/.bin/casefile-web`** —
   nothing to build in the CLI, but a second command to teach, no version
   check against the pinned CLI, and it bypasses delegation.
5. **Viewer opt-in (pin added on demand)** — lighter for CLI-only users, but
   without npm there is no way to add it later, so the tarball would carry it
   anyway and the two channels would stop being identical.

## Consequences

- A QA opens the viewer with `.casefile/node_modules/.bin/casefile ui` in any
  repository, with or without the npm registry, from the release that ships it.
- Three packages move in lockstep; the first publish of `@casefile/web` needs
  the `NPM_TOKEN` to be allowed to create it in the scope, and trusted
  publishing (#101) is configured per package.
- The tarball grows by about 0.4 MB.
- `ui.not_installed` is a new stable code; the README, the setup SPEC and
  `QUICKSTART.md` (step 8 says the viewer is not installed) change with the
  release that ships the command.
- `apps/web` gets a README (it becomes an npm page).
