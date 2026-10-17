import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCaseFile, parseCommonFile, parseConfigFile, parseRunFile } from "../load/parse.js";
import { CORE_SPECS_DIR } from "./spec.js";

/**
 * SPEC examples that name a file after the fence language (```yaml casefile.yaml)
 * must parse as that file: a SPEC cannot drift from the schemas (#5).
 */
const PARSERS: [RegExp, (path: string, text: string) => { ok: boolean }][] = [
  [/^casefile\.yaml$/, parseConfigFile],
  [/_common\.yaml$/, parseCommonFile],
  [/^TC-\d{4,}\.md$/, parseCaseFile],
  [/\.jsonl$/, (path, text) => ({ ok: parseRunFile(path, text).errors.length === 0 })],
];

const files = (await readdir(CORE_SPECS_DIR)).filter((f) => f.endsWith(".md"));
const examples = (
  await Promise.all(
    files.map(async (spec) => {
      const text = await readFile(join(CORE_SPECS_DIR, spec), "utf8");
      return [...text.matchAll(/^```\w+ (\S+)\n([\s\S]*?)^```$/gm)].map(([, name, body]) => ({
        spec,
        name: name as string,
        body: body as string,
      }));
    }),
  )
).flat();

describe("SPEC examples", () => {
  it("include the setup and cover examples", () => {
    const named = examples.map((e) => `${e.spec}:${e.name}`);
    expect(named).toContain("setup.md:casefile.yaml");
    expect(named).toContain("setup.md:_common.yaml");
    expect(named).toContain("cover.md:TC-0003.md");
    expect(named).toContain("ingest.md:9137.jsonl");
  });

  it.each(examples.map((e) => [`${e.spec} ${e.name}`, e] as const))("%s parses", (_, e) => {
    const parse = PARSERS.find(([pattern]) => pattern.test(e.name))?.[1];
    expect(parse, `no parser for example file ${e.name}`).toBeDefined();
    expect(parse?.(e.name, e.body)).toMatchObject({ ok: true });
  });
});
