# casefile is published under the npm scope `@casefile`

## Status

Accepted — 2026-10-17 (#63). Amends the package names of
[build-and-test-tooling](2026-10-15-build-and-test-tooling.md) §4 and
[apps-vs-packages](2026-10-15-apps-vs-packages.md) rule 4, and the pinned package of
[casefile-toolchain-dir](2026-10-15-casefile-toolchain-dir.md).

## Context

The unscoped npm name `casefile` belongs to an unrelated package (an audit
scanner for agent skills, v0.2.1). Every doc said `npx casefile init`, and
`.casefile/package.json` pinned `casefile`. That ran someone else's code, or
failed with `ETARGET` once no version matched. A real setup could never install
its toolchain, so `validate` stayed at `toolchain.not_installed` (found trying
`casefile-setup` by hand, #56). The same decision settles whether core is
published. Extensions register operations through core's API
([extension-model](2026-10-15-extension-model.md)), so their authors need a core
package to depend on.

## Decision

1. **Scope `@casefile`** (an npm organization owned by the maintainer):
   - `@casefile/cli` — the CLI; its bin is still `casefile`. Published, with
     the skills bundle.
   - `@casefile/core` — the library extensions build on (`defineOperation`,
     types, schemas). Published. Extensions declare it as a `peerDependency`.
   - `@casefile/web`, `@casefile/mcp` — names reserved; still `private`. How
     `casefile ui` / `casefile mcp` reach them stays open
     ([local-ui-stack](2026-10-17-local-ui-stack.md)).
   - Extension packages may use the scope (`@casefile/ext-…`) or their own
     name; what makes a package an extension is its manifest.
2. **The command stays `casefile`.** The package name and the bin name are two
   constants in core: `CASEFILE_PACKAGE = "@casefile/cli"` and
   `CASEFILE_BIN = "casefile"`.
3. **Toolchain:** `.casefile/package.json` pins `@casefile/cli` at an exact
   version. The installed CLI is `.casefile/node_modules/.bin/casefile`.
4. **The human starts with** `npx @casefile/cli init` (or a global
   `npm install -g @casefile/cli`). Docs, SPECs and skills never say
   `npx casefile`.
5. **Lockstep versions:** the published packages share one version, and
   `@casefile/cli` depends on `@casefile/core` at that exact version. Each
   `package.json` keeps `private: true` until the release process lands, so
   nothing is published by accident.
6. **Before the first publish**, a workspace inside this repository links its
   toolchain to the source. `node scripts/link-toolchain.mjs <workspace>`
   symlinks `.casefile/node_modules/@casefile/cli` to `apps/cli`. That path is
   gitignored, so nothing linked is committed. The example of #35 runs this
   way, and `pnpm casefile --cwd <workspace>` runs the CLI from source.

## Alternatives Considered

- **Unscoped `casefile-cli` with core bundled inside** — no organization to
  create, but extension authors would have no core package to import. Bundling
  also needs a bundler for the CLI, which build-and-test-tooling avoids.
- **A personal scope (`@amarturelo/casefile`)** — ties an open-source project
  to one account; moving it later renames every install.
- **Asking npm for the `casefile` name** — not in our control, and the current
  owner publishes actively.
- **Publishing core unscoped (`casefile-core`)** — two unrelated-looking names,
  and no namespace to keep the related packages together.

## Consequences

- Code: `CASEFILE_PACKAGE` changes and `CASEFILE_BIN` is new (delegation looks
  up the bin by name). `init` pins `@casefile/cli`. Fixtures and tests follow.
- Docs, SPECs and skills say `@casefile/cli`. Dependabot keeps watching
  `/.casefile`.
- The maintainer creates the npm organization `casefile` before the first
  release. Until then the scope is unclaimed, and that is a risk to watch.
- A release issue flips `private`, publishes in lockstep, and adds provenance.
