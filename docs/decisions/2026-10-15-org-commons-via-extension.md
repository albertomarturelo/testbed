# Org-level commons are shipped by an extension package

## Status

Accepted — 2026-10-15 (#3)

## Context

Inheritance is "org → root → ancestors → case", but the brief gives the org level
no location. It must be shared across repos, versioned, and reproducible —
[files-are-source-of-truth](2026-10-15-files-are-source-of-truth.md) rules out
anything whose content can change without a change in the repo.

## Decision

- An org publishes an npm package that is a casefile extension
  ([extension-model](2026-10-15-extension-model.md)); its manifest gains an
  optional `commons` field (same schema as `_common.yaml`).
- The repo lists it in `casefile.yaml` → `extensions`. Its exact version is
  pinned by the repo's lockfile, so a resolution is reproducible from the repo.
- Resolution order: **extension commons (in `extensions` order) → root
  `_common.yaml` → ancestors → case**. Merge rules are the same at every level.
- `casefile resolve` reports org-level origins as `ext:<package>@<version>`.
- No extension with `commons` → there is simply no org level.

## Alternatives Considered

- **Path in the user's home (`~/.casefile/org.yaml`)** — differs per machine; CI
  and teammates resolve different cases. Rejected.
- **Remote URL fetched at runtime** — network dependency, content can change
  under a fixed repo state. Rejected.
- **Git submodule with a `_common.yaml`** — reproducible, but submodules are a
  well-known source of friction and need a second mechanism next to extensions.
- **Drop the org level** — simplest, but loses a feature the brief names; the
  extension mechanism makes it nearly free.

## Consequences

- The resolver takes an ordered list of commons layers; tests inject layers
  without real packages (#7).
- The extension manifest schema includes `commons` (#5).
- Org-level `_properties.yaml` is **not** covered here; it waits for a real need.
