# JSON Schemas are generated from Zod and committed

## Status

Accepted — 2026-10-15 (#5). Supersedes the "defined twice" point of
[initial-architecture](2026-10-15-initial-architecture.md), which rejected
generation "for F0, may revisit".

## Context

Every file format needs runtime validation in TypeScript (Zod) and a published,
language-neutral contract (JSON Schema 2020-12) for editors, CI and other tools.
Zod 4.6 generates draft 2020-12 natively (`z.toJSONSchema`), keeping patterns,
enums, `additionalProperties: false` and discriminated unions (`oneOf`). Writing
both by hand means every field change is made twice, and a parity test only
catches drift on the samples it happens to cover.

## Decision

1. **Zod is the single source** (`packages/core/src/schema/`). JSON Schemas in
   `packages/core/schema/<name>.schema.json` are **generated and committed**,
   so they are reviewable in diffs and shipped in the package.
2. A test regenerates them and fails if the committed files differ
   (`pnpm --filter @casefile/core schemas` rewrites them).
3. A **parity test** runs every valid and invalid sample through both Zod and
   the committed JSON Schema (Ajv 2020, dev-only), so a Zod feature that does
   not translate is caught.
4. **Schemas are structural only**: types, enums, patterns, required fields,
   no unknown keys. Cross-field and cross-file rules (an enum property's
   `default` is one of its `values`, `feature` mirrors the folder, a label key is
   declared in `_properties.yaml`, an inbox `kind` is a registered operation) go
   in the validator (#9). No `.refine()` in schemas, since it does not translate.
5. **Formats are enforced by `pattern`**, not by `format` (e.g. `date-time`);
   consumers do not need format plugins. Emails use a permissive pattern
   (`local@domain`), not RFC 5322.
6. Schemas cover **files**: test case, `_common.yaml`, `_properties.yaml`, run
   event, inbox item, release policy, `casefile.workspace.yaml`, `casefile.yaml`.
   The extension manifest is a JavaScript module, not a file; its shape is
   defined with the operation registry (#11).
7. The resolved case is not a file; its type is defined with the resolver (#7).

## Decisions on fields not fixed by the brief

- A case **file** may omit what commons can supply (`surfaces`, `layer`,
  `priority`, `automation.eligible`, `labels`, `preconditions`, `data`); the
  resolver (#7) checks the **resolved** case has them.
- Every case has at least one `history` event (its creation).
- Inbox `kind` is an open slug, not the brief's fixed enum, because
  [extension-model](2026-10-15-extension-model.md) lets operations add kinds;
  the validator checks it against the registry.
- Inbox `result` stores `change` (UUID), not `commit`, for the same reason as
  [history-commit-reference](2026-10-15-history-commit-reference.md).
- `casefile.yaml` carries `version: 1` so the format can evolve.
- No `$id` URLs: there is no project domain yet; schemas are identified by file name.

## Alternatives Considered

- **Hand-written JSON Schema + hand-written Zod** (initial ADR) — double
  maintenance; parity only as good as the samples.
- **JSON Schema as source, generate TS types (json-schema-to-typescript) and
  validate with Ajv at runtime** — loses Zod's typed parsing and error
  messages; adds a codegen step to every build.
- **Generate at build time, do not commit** — the contract would be invisible
  in reviews and missing from the repo for non-JS consumers.

## Consequences

- `zod` is a runtime dependency of `@casefile/core`; `ajv` is dev-only.
- Changing a schema means changing Zod and running the generator; CI catches
  forgetting the second step.
