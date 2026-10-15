import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { type FileSchemaName, fileSchemas, toJsonSchema } from "./index.js";
import { samples } from "./samples.fixture.js";

const names = Object.keys(fileSchemas) as FileSchemaName[];

function committedJsonSchema(name: FileSchemaName): Record<string, unknown> {
  const url = new URL(`../../schema/${name}.schema.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

// Formats are enforced by `pattern`; Ajv only needs to know the names (ADR schemas-generated-from-zod).
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  formats: { "date-time": true, date: true, uuid: true },
});

describe.each(names)("%s schema", (name) => {
  const { schema } = fileSchemas[name];
  const { valid, invalid } = samples[name];
  const validateJson = ajv.compile(committedJsonSchema(name));

  it("committed JSON Schema matches the Zod source (run `pnpm --filter @casefile/core schemas`)", () => {
    expect(committedJsonSchema(name)).toEqual(toJsonSchema(name));
  });

  it.each(valid)("accepts $name in Zod and JSON Schema", ({ value }) => {
    expect(schema.safeParse(value).error).toBeUndefined();
    expect(validateJson(value), JSON.stringify(validateJson.errors)).toBe(true);
  });

  it.each(invalid)("rejects $name in Zod and JSON Schema", ({ value }) => {
    expect(schema.safeParse(value).success).toBe(false);
    expect(validateJson(value)).toBe(false);
  });
});

it("every file schema has samples", () => {
  expect(Object.keys(samples).sort()).toEqual([...names].sort());
});
