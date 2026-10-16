import { z } from "zod";
import { CommonFile } from "./common.js";
import { Config } from "./config.js";
import { InboxItem } from "./inbox-item.js";
import { PropertiesFile } from "./properties.js";
import { ReleasePolicy } from "./release-policy.js";
import { RunEvent } from "./run-event.js";
import { TestCaseFile } from "./test-case.js";

export * from "./common.js";
export * from "./config.js";
export * from "./inbox-item.js";
export * from "./primitives.js";
export * from "./properties.js";
export * from "./release-policy.js";
export * from "./run-event.js";
export * from "./test-case.js";

/** Every file format, keyed by the name of its generated `schema/<name>.schema.json`. */
export const fileSchemas = {
  "test-case": { title: "casefile test case (frontmatter)", schema: TestCaseFile },
  common: { title: "casefile _common.yaml", schema: CommonFile },
  properties: { title: "casefile _properties.yaml", schema: PropertiesFile },
  "run-event": { title: "casefile run event (.runs/*.jsonl line)", schema: RunEvent },
  "inbox-item": { title: "casefile inbox item", schema: InboxItem },
  "release-policy": { title: "casefile releases/policy.yaml", schema: ReleasePolicy },
  config: { title: "casefile.yaml (workspace root)", schema: Config },
} as const;

export type FileSchemaName = keyof typeof fileSchemas;

/** JSON Schema (2020-12) for a file format, as committed under `packages/core/schema/`. */
export function toJsonSchema(name: FileSchemaName): Record<string, unknown> {
  const { title, schema } = fileSchemas[name];
  const generated = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  const { $schema, ...rest } = generated;
  return { $schema, title, ...rest };
}
