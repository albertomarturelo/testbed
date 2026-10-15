import { describe, expect, it } from "vitest";
import {
  parseCaseFile,
  parseCommonFile,
  parseConfigFile,
  parseRunFile,
  parseYaml,
} from "./parse.js";

const CASE = `---
id: TC-0001
feature: auth/login
title: Sign in
state: draft
origin: agent
steps:
  - do: Submit valid credentials
    expect: The dashboard opens
history:
  - at: 2026-10-15T10:00:00Z
    by: ana@example.com
    via: cli:cover
    change: 3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44
    event: created
---
Body.
`;

const RUN = {
  run_id: "r1",
  case_id: "TC-0001",
  status: "passed",
  executor: "ci:github-actions",
  at: "2026-10-15T12:00:00Z",
};

describe("parseYaml", () => {
  it("keeps unquoted timestamps as strings", () => {
    expect(parseYaml("x.yaml", "at: 2026-10-15T10:00:00Z")).toEqual({
      ok: true,
      value: { at: "2026-10-15T10:00:00Z" },
    });
  });

  it("reports the line of a syntax error, offset into the file", () => {
    const result = parseYaml("x.md", "a: 1\nb: [\n", 2);
    expect(result.ok || result.errors).toEqual([
      expect.objectContaining({ code: "yaml.invalid", path: "x.md", line: expect.any(Number) }),
    ]);
    expect(!result.ok && result.errors[0]?.line).toBeGreaterThanOrEqual(3);
  });

  it("rejects duplicate keys", () => {
    expect(parseYaml("x.yaml", "a: 1\na: 2\n").ok).toBe(false);
  });
});

describe("parseCaseFile", () => {
  it("returns the validated frontmatter and the body", () => {
    const result = parseCaseFile("context/tests/auth/login/TC-0001.md", CASE);
    expect(result.ok && result.value.file.history[0]?.at).toBe("2026-10-15T10:00:00Z");
    expect(result.ok && result.value.body).toBe("Body.\n");
    expect(result.ok && result.value.path).toBe("context/tests/auth/login/TC-0001.md");
  });

  it("passes on frontmatter errors", () => {
    expect(parseCaseFile("a.md", "id: TC-0001\n").ok).toBe(false);
  });

  it("reports YAML errors at their line in the file", () => {
    const result = parseCaseFile("a.md", "---\nid: TC-0001\ntitle: [\n---\n");
    expect(result.ok || result.errors[0]).toMatchObject({ code: "yaml.invalid" });
    expect(!result.ok && result.errors[0]?.line).toBeGreaterThanOrEqual(3);
  });

  it("reports schema errors with the field path", () => {
    const result = parseCaseFile("a.md", CASE.replace("state: draft", "state: done"));
    expect(result.ok || result.errors).toEqual([
      expect.objectContaining({ code: "schema.invalid", path: "a.md", field: "state" }),
    ]);
  });
});

describe("parseCommonFile / parseConfigFile", () => {
  it("validates commons", () => {
    expect(parseCommonFile("_common.yaml", "layer: e2e\n")).toEqual({
      ok: true,
      value: { layer: "e2e" },
    });
    expect(parseCommonFile("_common.yaml", "layer: nope\n").ok).toBe(false);
  });

  it("reports a schema error on the whole document without a field", () => {
    const result = parseConfigFile("casefile.yaml", "- 1\n");
    expect(result.ok || result.errors[0]).not.toHaveProperty("field");
  });

  it("validates casefile.yaml", () => {
    expect(parseConfigFile("casefile.yaml", "version: 1\n")).toEqual({
      ok: true,
      value: { version: 1 },
    });
  });
});

describe("parseRunFile", () => {
  it("parses one event per non-blank line", () => {
    const text = `${JSON.stringify(RUN)}\r\n\n${JSON.stringify({ ...RUN, case_id: "TC-0002" })}\n`;
    const result = parseRunFile("r1.jsonl", text);
    expect(result.ok && result.value.map((e) => e.case_id)).toEqual(["TC-0001", "TC-0002"]);
  });

  it("reports every bad line with its number", () => {
    const text = [JSON.stringify(RUN), "{not json", JSON.stringify({ ...RUN, status: "ok" })].join(
      "\n",
    );
    const result = parseRunFile("r1.jsonl", text);
    expect(result.ok || result.errors).toEqual([
      expect.objectContaining({ code: "json.invalid", line: 2 }),
      expect.objectContaining({ code: "schema.invalid", line: 3, field: "status" }),
    ]);
  });
});
