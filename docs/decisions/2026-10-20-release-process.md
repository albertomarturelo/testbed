# Releases are tagged by the maintainer and published by CI

## Status

Accepted — 2026-10-20 (#97). Fulfils the release consequence of
[npm-scope-casefile](2026-10-17-npm-scope-casefile.md) (§5: `private` until a
release process exists).

## Context

`@casefile/core` and `@casefile/cli` are ready to pack: `pnpm pack` turns
`workspace:*` into the exact version, the CLI carries its skills, and the
packed CLI runs `casefile init` in an empty repository. Both are still
`private`, so a QA cannot run `npx @casefile/cli init`, which is the first step
of the authoring loop ([authoring-loop-first](2026-10-19-authoring-loop-first.md)).
The maintainer created the repository secret `NPM_TOKEN`. What is missing is how
a version is chosen, who decides to publish, and what CI checks before it does.

## Decision

1. **What is published:** `@casefile/core` and `@casefile/cli`, always together
   at one version; the CLI depends on core at that exact version.
   `@casefile/web` and `@casefile/mcp` stay `private`.
2. **Versions:** semver, starting at `0.1.0`. While `0.x`, a breaking change
   to a file format, an operation's input or output, or a CLI flag bumps the
   minor; anything else bumps the patch.
3. **A release is a PR, then a tag.** `node scripts/release.mjs set <x.y.z>`
   writes the version into both `package.json` files; it lands as
   `chore(release): v<x.y.z>`, together with any README change the release
   makes true (the README is the CLI's npm page, frozen per version). After it merges, the maintainer tags that
   commit `v<x.y.z>` on `main` and pushes the tag. Only the maintainer tags.
4. **CI publishes, on the tag** (`.github/workflows/release.yml`):
   install with the lockfile → build, typecheck, lint, test →
   `release.mjs check <tag>` (the tag equals both versions and the commit is
   on `main`) → `pnpm pack` both → smoke test: install the two tarballs in an
   empty directory, run `casefile --version` and `casefile init` in a temp Git
   repository → `npm publish <core.tgz>` then `<cli.tgz>`, `--access public
   --provenance`, skipping a package npm already has at that version (a rerun
   after a partial publish) → a GitHub release with generated notes, from a
   separate job that alone may write to the repository. Only a pushed tag
   publishes: a manual run, or a PR that touches packaging, does all of it with
   `npm publish --dry-run` and without the token.
5. **Auth and provenance:** the job authenticates with the secret `NPM_TOKEN`
   (a granular token that can only publish `@casefile/*`) and signs provenance
   through GitHub's OIDC (`id-token: write`), so each version on npm links to
   the commit and workflow run that built it. Nothing is published from a
   laptop.
6. **Package contents:** `dist`, plus `schema` and `specs` (core) or `skills`
   (CLI), a README and the MIT `LICENSE`. The CLI's README is the repository
   README and core has its own; both are copied at pack time where not
   committed, like the skills.
7. **Never unpublish.** A bad version is deprecated (`npm deprecate`) and fixed
   by a new patch.

## Alternatives Considered

- **Changesets** — per-change notes and automatic bumps, but a dependency and a
  bot PR for two packages that always move together.
- **release-please** — the same, driven by commit types; another bot, and
  squash subjects would have to stay perfectly typed.
- **Publish on every push to `main`** — no human decides what a QA installs;
  a docs merge would ship a version.
- **Publish from the maintainer's machine** — no provenance, a long-lived token
  on a laptop, and no record of what was built from which commit.
- **npm trusted publishing (OIDC, no token) now** — better, but npm configures
  it per existing package, so the first version needs a token. Move to it after
  `0.1.0` is out and revoke `NPM_TOKEN`.

## Consequences

- `private` leaves core and CLI; `repository`, `homepage` and `bugs` are added
  (npm checks `repository` against the provenance).
- The README's install section says `npx @casefile/cli init` once `0.1.0` is
  out; until then it keeps the from-source path.
- The scope must belong to the maintainer's npm organization `casefile`
  before the first tag, or the publish fails with 404/403.
- After `0.1.0`: configure trusted publishing for both packages, drop
  `NPM_TOKEN` from the workflow, revoke it.
