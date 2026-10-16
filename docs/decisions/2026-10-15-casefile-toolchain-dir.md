# casefile and its extensions are pinned in a toolchain package

## Status

Accepted — 2026-10-15 (#29). Amends [org-commons-via-extension](2026-10-15-org-commons-via-extension.md)
(which lockfile pins extensions) and extends `init` in
[agent-driven-setup](2026-10-15-agent-driven-setup.md).

## Context

[org-commons-via-extension](2026-10-15-org-commons-via-extension.md) makes a
resolution reproducible by pinning casefile and its extensions in the repo's
lockfile, which assumes a `package.json` at the workspace root. casefile targets
any product repo — Go, Python, Kotlin, Swift — where turning the root into a Node
project is friction. casefile is a Node CLI, so Node itself is always required;
the open question is only where exact versions live.

## Decision

1. **The toolchain package** is the `package.json` + lockfile that pins
   `casefile` and every extension listed in `casefile.yaml`, at exact versions:
   - the workspace root `package.json`, when the workspace already has one
     (casefile and extensions are its devDependencies, added by the agent with
     the repo's own package manager);
   - otherwise **`.casefile/package.json`** with its `package-lock.json`, both
     committed, plus `.casefile/.gitignore` ignoring `node_modules/`. It is
     managed with npm only, so no other package manager is needed.
2. **`init` creates `.casefile/`** when the root has no `package.json`: the
   manifest pins `casefile` to the version running `init`. It never edits a
   root `package.json`; in Node workspaces the setup skill adds the
   devDependency. Installing (which writes the lockfile) is
   `npm install --prefix .casefile`, run by the setup skill or CI.
3. **Extensions resolve from the toolchain**: core loads them with Node's
   resolution anchored at `.casefile/package.json` if it exists, else at the root
   `package.json`. Anchoring at `.casefile/` still finds the root's
   `node_modules`, so one mechanism serves both layouts. The version reported in
   `ext:<package>@<version>` is the installed one.
4. **The pinned casefile runs.** Whatever `casefile` binary is invoked (global,
   `npx`), it locates the workspace, finds the toolchain's installed casefile and,
   if the version differs, re-executes it with the same arguments (once; an
   environment flag prevents loops). Declared but not installed →
   `toolchain.not_installed` with the install command as hint. `init` never
   delegates: it must work before anything is installed.
5. **CI** runs `npm ci --prefix .casefile` (or the repo's usual install) and then
   `npm exec --prefix .casefile -- casefile <command>`.
6. **Ownership:** `.casefile/` follows `extensions` in `casefile.yaml` — the
   human (via `init` or by hand); the setup skill may run the install that writes
   the lockfile.

## Alternatives Considered

1. **`init` creates a root `package.json`** — same guarantees, but it turns a Go
   or Python repo into "a Node project" for every tool that looks (Dependabot,
   IDEs, language detection) and puts `node_modules/` at the root.
2. **Exact versions in `casefile.yaml`, run with `npx casefile@<ver>`** — no
   Node files in the repo, but casefile would have to fetch and verify
   extensions itself (a package manager of its own), and without a lockfile
   there are no integrity hashes.
3. **Node workspaces only in v1** — simplest, but excludes mobile and backend
   repos, the audience the monorepo model is for.
4. **Always `.casefile/`, even in Node workspaces** — one layout, but a second
   lockfile next to the repo's own drifts from its tooling (Renovate, audits).

## Consequences

- Reproducible from the repo alone: the committed lockfile (root or
  `.casefile/`) fixes versions and integrity; delegation makes the pinned
  casefile run regardless of the one invoked.
- #25: `init` writes `.casefile/` in non-Node workspaces; extension loading is
  anchored at the toolchain package.
- #11: the CLI delegates to the pinned version.
- #9 (environment level): `extension.not_installed` (listed but not resolvable),
  `toolchain.not_installed`, and a warning `toolchain.unpinned` when casefile is
  in no toolchain package.
