# Case frontmatter is split in core and parsed with `yaml`

## Status

Accepted — 2026-10-15 (#7). Replaces the planned gray-matter entry in
`docs/STACK.md` and `docs/ARCHITECTURE.md`.

## Context

The loader (#7) reads `context/tests/**/TC-NNNN.md`: a YAML frontmatter block
between `---` lines, then a Markdown body. The plan named gray-matter for this.
gray-matter 4.0.3 is CommonJS, has not had a release in years, and parses YAML
with js-yaml 3, which turns unquoted timestamps into `Date` objects that the
schemas reject (#5). Using it means configuring `yaml` as its engine anyway, so
js-yaml and three more transitive packages would ship unused.
CONVENTIONS #10: a new runtime dependency needs an ADR.

## Decision

1. **`yaml` (2.x, no dependencies) becomes a runtime dependency of
   `@casefile/core`**; it parses every YAML file and every frontmatter block.
   Parsing uses YAML 1.2 with the `core` schema: no timestamp tag, so dates stay
   strings and the Zod patterns validate them.
2. **Frontmatter is split by a small function in core** (`load/frontmatter.ts`):
   the file must start with a line `---`; the block ends at the next line that is
   exactly `---`; the rest is the body. A leading BOM and CRLF line endings are
   accepted. Anything else is an error value with the file path and a stable
   code (CONVENTIONS #7), not an exception.
3. Only YAML frontmatter is supported: no TOML/JSON front matter, no custom
   delimiters, no excerpts.

## Alternatives Considered

1. **gray-matter with `engines.yaml` set to `yaml`** — the planned option; works,
   but adds two runtime deps plus an unused js-yaml 3 chain, and its features
   (other languages, excerpts, stringify) are not needed.
2. **front-matter / other npm splitters** — same trade: a dependency for ~20 lines
   of code, most of them also bundling js-yaml.
3. **Regex in each caller** (as the #6 fixture test does) — no single place for
   the error codes and edge cases (BOM, CRLF, empty block).

## Consequences

- One runtime dependency (`yaml`) instead of two plus transitives.
- Core owns the splitting rules; the writer of case files (agent operations)
  must emit the same shape, which the round-trip test can cover.
- `docs/STACK.md` drops gray-matter from "Planned" and lists `yaml` as runtime.
