# Extension model: operations as the unit of extension

## Status

Accepted — 2026-10-15

## Context

The maintainer wants casefile to be easy to extend with new capabilities. The
brief already has two extensible surfaces (skills as markdown folders, custom
properties in `_properties.yaml`) and one planned interface (`Bridge`). It also
has a latent duplication: every verb (`cover`, `run`, `triage`, …) appears as a
CLI command, an MCP tool and an inbox `kind`. Implemented per app, adding a verb
means touching every app.

## Decision

### Four extension points

| Kind | Adds | Shape |
|---|---|---|
| **Operation** | a verb (`cover`, `certify`, …) | declared contract + `run()` |
| **Ingester** | a result format (JUnit, CTRF, Allure, …) | `parse(bytes) → RunEvent[]` |
| **Bridge** | a mirror (Zephyr, Xray, TestRail, …) | `push`, `pull`, `import(dryRun)` |
| **Validator** | a repo rule ("every P0 has `automation.ref`") | `check(index) → Finding[]` |

Skills and custom properties stay extensible as they are (folders / YAML).
The query DSL is **closed** in v1: no custom functions, so that one language
keeps working identically in UI filters, gates and the CLI.

### Operations are declared once

```ts
defineOperation({
  name: "cover",
  input: CoverInput,              // Zod; derives JSON Schema (MCP), flags (CLI), forms (web)
  output: CoverOutput,
  actor: ["agent"],               // who may invoke it
  writes: ["context/tests/**"],   // paths it may touch — enforced by core
  spec: "specs/cover.md",
  run: async (input, ctx) => { … },
});
```

Apps are generic hosts: the CLI renders the registry as commands, the MCP
server as tools, the inbox processor as `kind`s, the web UI as screens. The
write policy of [write-ownership](2026-10-15-write-ownership.md) is carried by
the declaration and enforced in core, the only write path.

### Built-ins use the same API

`cover`, `run`, the JUnit ingester, the Zephyr bridge, the standard validators —
all register through the public API with no privileged access. This is how the
API is kept honest before any external extension exists.

### Installation is explicit

`casefile.yaml` lists extensions by package name:

```yaml
extensions:
  - "@acme/casefile-ingest-playwright"
```

An extension package exports a manifest `{ operations, ingesters, bridges,
validators, skills? }`. No `node_modules` scanning, no auto-discovery.
Skills shipped by an extension are **offered** by `casefile init`, never
installed silently: a skill is text the agent executes, so silent injection is
a prompt-injection vector.

### Guard rails

- No sandbox. An extension has the trust of any npm dependency; documented as such.
- The manifest carries a version; the API is marked unstable until the F2 bridges
  (first real external consumers) land.

## Alternatives Considered

- **Per-app plugin APIs** (CLI plugins, MCP plugins, …) — each app grows its own
  extension surface; the verb duplication becomes a plugin-triplication.
- **Event hooks** (`onCaseCreated`, …) — flexible, but hooks compose badly, make
  write ownership unenforceable and hide control flow from the SPECs.
- **Auto-discovery by package name prefix** — convenient, but slow, magical and
  unauditable; conflicts with "files are the source of truth".
- **Open DSL with custom functions** — rejected to keep one query language
  across UI, gates and CLI.
- **No extension model in F0** — defers the cost, but the operation registry is
  needed anyway to stop CLI/MCP/inbox from diverging; the registry *is* the
  extension point.

## Consequences

- F0 pays one layer of indirection (the registry) before any external extension
  exists. Accepted for the reason above.
- Issues #11 (CLI) and #15 (MCP) become "first hosts over the registry".
- New issue: built-in ingesters (JUnit, CTRF, Allure).
- `defineOperation`'s `actor`/`writes` make #1 enforceable, not just documented.
