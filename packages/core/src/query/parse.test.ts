import { describe, expect, it } from "vitest";
import { MAX_QUERY_DEPTH, parseQuery, type QueryNode, queryVariables } from "./parse.js";

function parsed(text: string): QueryNode {
  const result = parseQuery(text);
  if (!result.ok) throw new Error(result.errors[0]?.message);
  return result.value;
}

/** Compact rendering of the tree, to assert precedence and grouping. */
function shape(node: QueryNode): string {
  switch (node.kind) {
    case "and":
    case "or":
      return `(${shape(node.left)} ${node.kind.toUpperCase()} ${shape(node.right)})`;
    case "not":
      return `NOT ${shape(node.operand)}`;
    case "compare":
      return `${node.path.text}${node.operator}`;
    case "in":
      return `${node.path.text} IN`;
    case "contains":
      return `${node.path.text} CONTAINS`;
  }
}

describe("parseQuery: precedence", () => {
  it.each([
    ["a = 1 OR b = 1 AND c = 1", "(a= OR (b= AND c=))"],
    ["a = 1 AND b = 1 OR c = 1", "((a= AND b=) OR c=)"],
    ["(a = 1 OR b = 1) AND c = 1", "((a= OR b=) AND c=)"],
    ["NOT a = 1 AND b = 1", "(NOT a= AND b=)"],
    ["NOT (a = 1 AND b = 1)", "NOT (a= AND b=)"],
    ["NOT NOT a = 1", "NOT NOT a="],
    ["a = 1 AND b = 1 AND c = 1", "((a= AND b=) AND c=)"],
    ["a = 1 OR b = 1 OR c = 1", "((a= OR b=) OR c=)"],
    ["((a = 1))", "a="],
    ["a IN (1) OR NOT b CONTAINS x AND c != 2", "(a IN OR (NOT b CONTAINS AND c!=))"],
  ])("%s", (text, expected) => {
    expect(shape(parsed(text))).toBe(expected);
  });

  it("accepts keywords in any case", () => {
    expect(shape(parsed("a = 1 and not b = 1 Or c In (1) AND d contains x"))).toBe(
      "((a= AND NOT b=) OR (c IN AND d CONTAINS))",
    );
  });
});

describe("parseQuery: values and paths", () => {
  it("types bare words as boolean, number or string and keeps their text", () => {
    expect(parsed("labels.smoke = true")).toEqual({
      kind: "compare",
      operator: "=",
      path: { kind: "field", segments: ["labels", "smoke"], text: "labels.smoke", start: 0 },
      value: { kind: "literal", value: true, text: "true", start: 15 },
      start: 0,
    });
    const values = ["false", "-2.5", "10", "TC-0001", "1.2.3"].map((word) => {
      const node = parsed(`x = ${word}`);
      return node.kind === "compare" ? node.value : null;
    });
    expect(values.map((v) => v?.kind === "literal" && v.value)).toEqual([
      false,
      -2.5,
      10,
      "TC-0001",
      "1.2.3",
    ]);
  });

  it("keeps quoted strings as strings without text", () => {
    expect(parsed(`title = "true"`)).toMatchObject({
      value: { kind: "literal", value: "true", start: 8 },
    });
    expect(parsed(`title = "true"`)).not.toHaveProperty("value.text");
    expect(parsed(`labels.k = 'AND'`)).toMatchObject({ value: { value: "AND" } });
  });

  it("reads `release.*` as context variables on either side", () => {
    const node = parsed("feature IN release.changed_features AND release.build = automation.ref");
    expect(queryVariables(node).map((v) => v.text)).toEqual([
      "release.changed_features",
      "release.build",
    ]);
    expect(
      queryVariables(parsed("NOT (a CONTAINS release.x OR b IN (1, release.y))")).map(
        (v) => v.text,
      ),
    ).toEqual(["release.x", "release.y"]);
    expect(parsed("x = release.build")).toMatchObject({
      value: { kind: "variable", segments: ["release", "build"], start: 4 },
    });
  });

  it("keeps a bare `release` as a field, not a variable", () => {
    expect(parsed("release = x")).toMatchObject({ path: { kind: "field", segments: ["release"] } });
    expect(queryVariables(parsed("x = release"))).toEqual([]);
  });

  it("parses IN lists of mixed values", () => {
    expect(parsed(`state IN (active, "in_review", 3, release.extra)`)).toMatchObject({
      kind: "in",
      list: [
        { kind: "literal", value: "active" },
        { kind: "literal", value: "in_review" },
        { kind: "literal", value: 3 },
        { kind: "variable", text: "release.extra" },
      ],
    });
  });

  it("reports the start offset of NOT, AND and OR nodes", () => {
    expect(parsed("  NOT a = 1")).toMatchObject({ kind: "not", start: 2 });
    expect(parsed("a = 1 OR b = 2")).toMatchObject({ kind: "or", start: 0, right: { start: 9 } });
  });
});

describe("parseQuery: errors with positions", () => {
  it.each([
    ["", "query.unexpected_end", 1, "expected a field path, but the query ends"],
    [
      "state",
      "query.unexpected_end",
      6,
      "expected an operator, IN or CONTAINS, but the query ends",
    ],
    ["state =", "query.unexpected_end", 8, "expected a value, but the query ends"],
    ["state = active AND", "query.unexpected_end", 19, "expected a field path, but the query ends"],
    ["(state = active", "query.unexpected_end", 16, "expected `)`, but the query ends"],
    [
      "state = active)",
      "query.unexpected_token",
      15,
      "expected AND, OR or the end of the query, found `)`",
    ],
    [
      "state = active priority = P0",
      "query.unexpected_token",
      16,
      "expected AND, OR or the end of the query, found `priority`",
    ],
    ["= active", "query.unexpected_token", 1, "expected a field path, found `=`"],
    ["AND = 1", "query.unexpected_token", 1, "expected a field path, found `AND`"],
    ["'state' = active", "query.unexpected_token", 1, "expected a field path, found `'state'`"],
    ["9lives = 1", "query.unexpected_token", 1, "expected a field path, found `9lives`"],
    ["a.b. = 1", "query.unexpected_token", 1, "expected a field path, found `a.b.`"],
    [
      "state active",
      "query.unexpected_token",
      7,
      "expected an operator, IN or CONTAINS, found `active`",
    ],
    ["state = AND", "query.unexpected_token", 9, "expected a value, found `AND`"],
    ["state = (active)", "query.unexpected_token", 9, "expected a value, found `(`"],
    [
      "state IN active",
      "query.unexpected_token",
      10,
      "expected `(` or a context variable after IN, found `active`",
    ],
    ["state IN ()", "query.unexpected_token", 11, "expected a value, found `)`"],
    ["state IN (a b)", "query.unexpected_token", 13, "expected `,` or `)`, found `b`"],
    ["state IN (a,)", "query.unexpected_token", 13, "expected a value, found `)`"],
    ["state IN (a", "query.unexpected_end", 12, "expected `,` or `)`, but the query ends"],
    [
      "state IN 'x'",
      "query.unexpected_token",
      10,
      "expected `(` or a context variable after IN, found `'x'`",
    ],
    [
      "state IN",
      "query.unexpected_end",
      9,
      "expected `(` or a context variable after IN, but the query ends",
    ],
    ["NOT", "query.unexpected_end", 4, "expected a field path, but the query ends"],
    ["a = = 1", "query.unexpected_token", 5, "expected a value, found `=`"],
    ["a = 'x", "query.unterminated_string", 5, "string opened with ' is never closed"],
  ])("%j → %s at column %i", (text, code, column, message) => {
    expect(parseQuery(text)).toEqual({ ok: false, errors: [{ code, column, message }] });
  });
});

describe("parseQuery: nesting depth", () => {
  const open = (n: number) => "(".repeat(n);
  const close = (n: number) => ")".repeat(n);

  it(`accepts ${MAX_QUERY_DEPTH} levels of parentheses and NOT`, () => {
    expect(parseQuery(`${open(MAX_QUERY_DEPTH)}a = 1${close(MAX_QUERY_DEPTH)}`).ok).toBe(true);
    expect(parseQuery(`${"NOT ".repeat(MAX_QUERY_DEPTH)}a = 1`).ok).toBe(true);
    expect(parseQuery(`${open(32)}${"NOT ".repeat(32)}a = 1${close(32)}`).ok).toBe(true);
  });

  it("fails one level deeper at the token that exceeds it", () => {
    expect(parseQuery(`${open(MAX_QUERY_DEPTH + 1)}a = 1${close(MAX_QUERY_DEPTH + 1)}`)).toEqual({
      ok: false,
      errors: [
        {
          code: "query.too_deep",
          column: MAX_QUERY_DEPTH + 1,
          message: `query nests NOT and parentheses deeper than ${MAX_QUERY_DEPTH} levels`,
        },
      ],
    });
    expect(parseQuery(`${"NOT ".repeat(MAX_QUERY_DEPTH + 1)}a = 1`)).toMatchObject({
      ok: false,
      errors: [{ code: "query.too_deep", column: MAX_QUERY_DEPTH * 4 + 1 }],
    });
  });

  it("fails hostile input as a value instead of overflowing the stack", () => {
    expect(parseQuery(open(100_000))).toMatchObject({
      ok: false,
      errors: [{ code: "query.too_deep" }],
    });
  });

  it("counts depth per branch, not per query", () => {
    const branch = `${open(MAX_QUERY_DEPTH)}a = 1${close(MAX_QUERY_DEPTH)}`;
    expect(parseQuery(`${branch} AND ${branch}`).ok).toBe(true);
  });
});
