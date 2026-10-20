# @casefile/core

The library behind [casefile](https://github.com/albertomarturelo/testbed#readme):
test cases kept as files in the product repository, written by an agent or a QA
through operations, and read in a local viewer.

You install this package directly only to **build an extension**: an
operation, an ingester for a test report format, or organisation-wide commons.
To use casefile in a repository, start with the CLI instead:

```bash
npx @casefile/cli init
```

## What it contains

- **Schemas** (Zod, and their JSON Schema in `schema/`) for every file casefile
  reads: `casefile.yaml`, `_common.yaml`, case files, run files.
- **The resolver**: a case after inheritance from its commons, with where each
  value came from.
- **The query language** used by the CLI, the viewer and release gates.
- **Operations** (`defineOperation`, the registry) and the built-in ones:
  `init`, `project add`, `cover`, `validate`, `resolve`, `query`, `overview`,
  `runs`, `ingest junit`.
- **SPECs** in `specs/`: the contract of each operation, also printed by
  `casefile spec <name>`.

## Writing an extension

An extension is a package that declares `@casefile/core` as a
`peerDependency` and registers operations or ingesters through its API
(`defineOperation`, `defineIngester`). A workspace installs extensions next to
the CLI in `.casefile/`, at pinned versions. The design is in
[ADR extension-model](https://github.com/albertomarturelo/testbed/blob/main/docs/decisions/2026-10-15-extension-model.md).

`@casefile/core` and `@casefile/cli` are released together at one version;
pin core at the version of the CLI the workspace uses.

## License

MIT
