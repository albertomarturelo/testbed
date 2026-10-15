#!/usr/bin/env node
// Regenerates packages/core/schema/*.schema.json from the built Zod schemas
// (ADR 2026-10-15-schemas-generated-from-zod). Run after `pnpm build`.
import { writeFileSync } from "node:fs";
import { fileSchemas, toJsonSchema } from "../dist/index.js";

const outDir = new URL("../schema/", import.meta.url);
for (const name of Object.keys(fileSchemas)) {
  const file = new URL(`${name}.schema.json`, outDir);
  writeFileSync(file, `${JSON.stringify(toJsonSchema(name), null, 2)}\n`);
  console.log(`wrote schema/${name}.schema.json`);
}
