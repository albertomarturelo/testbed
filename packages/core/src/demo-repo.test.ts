import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { z } from "zod";
import { DEMO_EXPECTED, DEMO_ROOT } from "./demo.fixture.js";
import {
  CommonFile,
  Config,
  InboxItem,
  PropertiesFile,
  ReleasePolicy,
  RunEvent,
  TestCaseFile,
  Workspace,
} from "./schema/index.js";

// Fixture integrity only. The real loader (#7) and validator (#9) replace this parsing.

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

function frontmatter(text: string): unknown {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("missing frontmatter");
  return parse(match[1] ?? "");
}

type Entry = { file: string; schema: z.ZodType; value: unknown };

function classify(file: string): Entry[] | "doc" {
  const rel = relative(DEMO_ROOT, file).split(sep).join("/");
  const text = readFileSync(file, "utf8");
  const one = (schema: z.ZodType, value: unknown): Entry[] => [{ file: rel, schema, value }];
  if (rel === "casefile.yaml") return one(Config, parse(text));
  if (rel === "casefile.workspace.yaml") return one(Workspace, parse(text));
  if (rel === "context/releases/policy.yaml") return one(ReleasePolicy, parse(text));
  if (rel === "context/tests/_properties.yaml") return one(PropertiesFile, parse(text));
  if (rel.startsWith("context/tests/")) {
    if (basename(rel) === "_common.yaml") return one(CommonFile, parse(text));
    if (/\/TC-\d{4,}\.md$/.test(rel)) return one(TestCaseFile, frontmatter(text));
    if (/^context\/tests\/\.runs\/[^/]+\.jsonl$/.test(rel)) {
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line, i) => ({ file: `${rel}:${i + 1}`, schema: RunEvent, value: JSON.parse(line) }));
    }
    if (/^context\/tests\/\.inbox\/[0-9a-f]{12}\/[^/]+\.yaml$/.test(rel)) {
      return one(InboxItem, parse(text));
    }
    throw new Error(`unexpected file under context/tests: ${rel}`);
  }
  return "doc";
}

const files = [...walk(DEMO_ROOT)];
const entries = files.flatMap((file) => {
  const result = classify(file);
  return result === "doc" ? [] : result;
});

describe("examples/demo-repo", () => {
  it.each(entries.map((e) => [e.file, e] as const))("%s matches its schema", (_, entry) => {
    const result = entry.schema.safeParse(entry.value);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  // Invalid cases are reported by the per-file test above; the checks below use the valid ones.
  const cases = entries.flatMap((e) => {
    if (e.schema !== TestCaseFile) return [];
    const parsed = TestCaseFile.safeParse(e.value);
    return parsed.success ? [{ file: e.file, value: parsed.data }] : [];
  });

  it("has the expected cases and states", () => {
    expect(cases.map((c) => c.value.id).sort()).toEqual([...DEMO_EXPECTED.caseIds]);
    const states: Record<string, number> = {};
    for (const c of cases) states[c.value.state] = (states[c.value.state] ?? 0) + 1;
    expect(states).toEqual(DEMO_EXPECTED.states);
  });

  it("names each case file after its id and places it under its feature", () => {
    for (const c of cases) {
      expect(basename(c.file, ".md")).toBe(c.value.id);
      expect(dirname(c.file)).toBe(`context/tests/${c.value.feature}`);
    }
  });

  it("has the expected top-level features", () => {
    const top = new Set(cases.map((c) => c.value.feature.split("/")[0]));
    expect([...top].sort()).toEqual([...DEMO_EXPECTED.topLevelFeatures]);
  });

  it("gives TC-0003 a chain of at least two commons levels", () => {
    const commons = new Set(entries.filter((e) => e.schema === CommonFile).map((e) => e.file));
    const tc3 = cases.find((c) => c.value.id === "TC-0003");
    const segments = (tc3?.value.feature ?? "").split("/");
    const chain = ["context/tests/_common.yaml"];
    for (let i = 1; i <= segments.length; i++) {
      chain.push(`context/tests/${segments.slice(0, i).join("/")}/_common.yaml`);
    }
    expect(chain.filter((f) => commons.has(f))).toEqual([...DEMO_EXPECTED.tc0003CommonsChain]);
  });

  it("names run files after their run_id", () => {
    const runs = entries.filter((e) => e.schema === RunEvent);
    const runFiles = new Set(runs.map((e) => e.file.replace(/:\d+$/, "")));
    expect(runFiles.size).toBe(DEMO_EXPECTED.runFiles);
    for (const e of runs) {
      const { run_id } = RunEvent.parse(e.value);
      expect(basename(e.file.replace(/:\d+$/, ""), ".jsonl")).toBe(run_id);
    }
  });

  it("has the expected inbox items", () => {
    expect(entries.filter((e) => e.schema === InboxItem)).toHaveLength(DEMO_EXPECTED.inboxItems);
  });
});
