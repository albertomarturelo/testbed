# casefile and its extensions are pinned in `.casefile/`

## Status

Accepted — 2026-10-15 (#29). Amends [org-commons-via-extension](2026-10-15-org-commons-via-extension.md)
(which lockfile pins extensions) and extends `init` in
[agent-driven-setup](2026-10-15-agent-driven-setup.md).

## Context

[org-commons-via-extension](2026-10-15-org-commons-via-extension.md) makes a
resolution reproducible by pinning casefile and its extensions in the repo's
lockfile, which assumes a `package.json` at the workspace root. casefile targets
any product repo — Go, Python, Kotlin, Swift, or Node — and should not change
the configuration of the project that adopts it. casefile is a Node CLI, so Node
itself is always required; the open question is only where exact versions live.

## Decision

1. **Every workspace has a toolchain directory `.casefile/`**, whatever the
   product's language: `.casefile/package.json` pins `casefile` and every
   extension listed in `casefile.yaml` at exact versions; its
   `package-lock.json` is committed; `.casefile/.gitignore` ignores
   `node_modules/`. It is managed with npm only. The product's own
   `package.json`, if any, is never created or edited.
2. **`init` creates `.casefile/`** (if absent) with `casefile` pinned to the
   version running `init`. Installing, which writes the lockfile, is
   `npm install --prefix .casefile`, run by the setup skill or CI. Adding an
   extension is `npm install --prefix .casefile --save-exact <pkg>` plus its
   entry in `casefile.yaml`.
3. **Extensions resolve from `.casefile/node_modules` only.** A package found
   further up (e.g. in the product's root `node_modules`) does not count, so
   the product's dependencies cannot change what casefile loads. The version
   reported in `ext:<package>@<version>` is the one installed there.
4. **The pinned casefile runs.** Whatever `casefile` binary is invoked (global,
   `npx`), it locates the workspace, finds `.casefile/`'s installed casefile and,
   if the version differs, re-executes it with the same arguments (once; an
   environment flag prevents loops). Declared but not installed →
   `toolchain.not_installed` with the install command as hint. `init` never
   delegates: it must work before anything is installed.
5. **CI** runs `npm ci --prefix .casefile`, then
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
4. **Mixed: the root `package.json` in Node workspaces, `.casefile/` otherwise**
   — avoids a second lockfile in Node repos, but edits the product's manifest,
   gives two layouts to support and document, and makes the agent pick the
   repo's package manager. One rule was preferred.

## Consequences

- Reproducible from the repo alone: `.casefile/package-lock.json` fixes versions
  and integrity; delegation makes the pinned casefile run regardless of the one
  invoked.
- Node repos get a second lockfile; dependency bots must also watch
  `.casefile/` (e.g. Dependabot `directory: /.casefile`), which the setup SPEC
  documents.
- #25: `init` always writes `.casefile/`; extension loading reads only
  `.casefile/node_modules`.
- #11: the CLI delegates to the pinned version.
- #9 (environment level): `extension.not_installed` (listed but not installed in
  `.casefile/`), `toolchain.not_installed`, and a warning `toolchain.unpinned`
  when `.casefile/package.json` does not pin casefile.
