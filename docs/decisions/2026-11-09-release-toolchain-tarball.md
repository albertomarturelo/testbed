# Each release ships a toolchain tarball, so casefile installs without npm

## Status

Accepted — 2026-11-09. Amends [casefile-toolchain-dir](2026-10-15-casefile-toolchain-dir.md)
(§1 "managed with npm only", §2 and §5: a second way to fill `.casefile/node_modules`)
and [release-process](2026-10-20-release-process.md) (§4: one more release asset).

## Context

The only way to install casefile in a product repository is
`npm install --prefix .casefile`, which needs the npm registry. The maintainer
wants to adopt casefile in a company whose network (VPN) blocks
`registry.npmjs.org`; packages only arrive through a Nexus mirror, one request
per library. GitHub Releases is reachable there and Node ≥ 22 is installed.
casefile's whole runtime is `@casefile/cli`, `@casefile/core`, `yaml` and `zod`:
pure JavaScript, no install scripts, no native code. So the block is the
channel, not the language or the runtime.

## Decision

1. **Asset.** Every release `v<x.y.z>` carries
   `casefile-toolchain-<x.y.z>.tgz` and `casefile-toolchain-<x.y.z>.tgz.sha256`
   (the `shasum -a 256` line for that file name). The tarball holds one
   top-level directory, `node_modules/`, exactly as
   `npm install --ignore-scripts --omit=dev` lays out the two packed tarballs
   of that release in an empty directory: `@casefile/cli`, `@casefile/core`,
   `yaml`, `zod` and `.bin/casefile`. It has no `package.json`: the pin belongs
   to the workspace.
2. **Built by the release workflow, from what npm gets.** After the existing
   pack and smoke test, the job installs the same two `.tgz` files, archives
   `node_modules/`, writes the checksum, and smoke-tests the result with no
   registry involved: unpack into `<empty repo>/.casefile/`, run
   `--version` and `init` through `.casefile/node_modules/.bin/casefile`. The
   `github-release` job attaches both files. A dry run (PR, manual) builds and
   tests them without attaching.
3. **Install without npm** (the agent runs it, per the setup SPEC):
   download both assets from
   `https://github.com/<repo>/releases/download/v<x.y.z>/` (or
   `gh release download v<x.y.z> --pattern 'casefile-toolchain-*'`), check
   `shasum -a 256 -c casefile-toolchain-<x.y.z>.tgz.sha256`, then
   `mkdir -p .casefile && tar -xzf casefile-toolchain-<x.y.z>.tgz -C .casefile`.
   In a new repository, `init` runs next from the unpacked binary. To change
   version: edit the pin, delete `.casefile/node_modules`, unpack the new one.
4. **The pin does not change.** `.casefile/package.json` still pins
   `@casefile/cli` at an exact version and `.casefile/.gitignore` still ignores
   `node_modules/`; delegation, `toolchain.not_installed` and
   `toolchain.unpinned` work as they do today, because the files on disk are
   the ones npm would have written. A workspace installed this way has no
   `package-lock.json`: its integrity check is the release checksum at install.
5. **npm stays the default channel.** The tarball is the documented
   alternative for networks without the registry. The `toolchain.not_installed`
   hint, the setup SPEC and the README install section name both.
6. **Scope: casefile only.** The tarball never carries extensions. A workspace
   that lists extensions in `casefile.yaml` still needs npm (or a mirror) for
   them. The viewer joins the tarball when `casefile ui` ships (#113).

## Alternatives Considered

1. **One bundled `.js` (esbuild or similar)** — a single file to copy, but a
   bundler is a new dependency, `specs/`, `schema/` and `skills/` must travel
   beside it, the code that runs is no longer the code npm publishes, and
   delegation would need a second way to find the pinned casefile.
2. **A binary per platform (Node SEA)** — removes the Node requirement, which
   nobody asked for: one build per OS and architecture, ~80–100 MB each, code
   signing on macOS and Windows.
3. **Rewrite in Python** — weeks of work on core, the validator, the DSL, the
   schemas and the CLI; the viewer stays React, so two languages; and networks
   that block npm usually block PyPI the same way.
4. **Ask for the packages in the company mirror** — no work here, but one
   request per library and per version, in every company that adopts casefile.
5. **Commit `.casefile/node_modules` to the product repository** — works
   offline, but casefile-toolchain-dir's trust rule exists to forbid exactly
   that: code that runs would be reviewed as a vendored diff nobody reads.
6. **Clone casefile and build from source** — needs `pnpm install`, so the
   registry again.

## Consequences

- A QA behind a registry block installs casefile with `curl`/`gh`, `shasum`
  and `tar`; nothing in core's resolution or the CLI's delegation changes.
- Two channels must stay equivalent. The workflow builds the tarball from the
  packed tarballs it publishes, so they cannot drift within a release.
- Weaker integrity than a lockfile: one checksum per release, verified once at
  install, and no provenance attestation on the asset. Acceptable while the
  asset is built in the same job that signs the npm provenance; revisit with
  GitHub artifact attestations if a company asks.
- Without a lockfile, dependency bots do not see the workspace; upgrades are
  manual (edit the pin, unpack).
- `.bin/casefile` is a symlink in the tarball. Where `tar` cannot create
  symlinks (Windows without developer mode), run
  `node .casefile/node_modules/@casefile/cli/dist/bin.js` instead.
- The trust rule is unchanged: `.casefile/node_modules` is never committed;
  each clone unpacks the verified tarball.
- Extensions without npm stay undecided; decide when the first real extension
  must reach a blocked network.
