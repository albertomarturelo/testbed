import { describe, expect, it } from "vitest";
import { type Token, tokenize } from "./tokenize.js";

function tokens(text: string): Token[] {
  const result = tokenize(text);
  if (!result.ok) throw new Error(result.errors[0]?.message);
  return result.value;
}

describe("tokenize", () => {
  it("splits words, operators and punctuation with 0-based offsets", () => {
    expect(tokens("a.b >= 3 AND (x, y)")).toEqual([
      { kind: "word", text: "a.b", start: 0 },
      { kind: "operator", text: ">=", start: 4 },
      { kind: "word", text: "3", start: 7 },
      { kind: "word", text: "AND", start: 9 },
      { kind: "lparen", text: "(", start: 13 },
      { kind: "word", text: "x", start: 14 },
      { kind: "comma", text: ",", start: 15 },
      { kind: "word", text: "y", start: 17 },
      { kind: "rparen", text: ")", start: 18 },
      { kind: "end", text: "", start: 19 },
    ]);
  });

  it("reads every comparison operator without surrounding spaces", () => {
    const operators = tokens("a=1 a!=1 a<1 a<=1 a>1 a>=1")
      .filter((t) => t.kind === "operator")
      .map((t) => t.text);
    expect(operators).toEqual(["=", "!=", "<", "<=", ">", ">="]);
  });

  it("keeps bare words with dashes, dots, colons and plus signs whole", () => {
    expect(tokens("web-1.2.0+101 release:web-1.2.0 checkout/payments").map((t) => t.text)).toEqual([
      "web-1.2.0+101",
      "release:web-1.2.0",
      "checkout/payments",
      "",
    ]);
  });

  it("reads single- and double-quoted strings with escapes", () => {
    expect(tokens(`"say \\"hi\\"" 'it\\'s' "a\\\\b" 'AND'`)).toEqual([
      { kind: "string", text: `"say \\"hi\\""`, value: 'say "hi"', start: 0 },
      { kind: "string", text: `'it\\'s'`, value: "it's", start: 13 },
      { kind: "string", text: `"a\\\\b"`, value: "a\\b", start: 21 },
      { kind: "string", text: "'AND'", value: "AND", start: 28 },
      { kind: "end", text: "", start: 33 },
    ]);
  });

  it("returns only the end token for blank input", () => {
    expect(tokens("  \t ")).toEqual([{ kind: "end", text: "", start: 4 }]);
  });

  it("fails on an unterminated string at its opening quote", () => {
    expect(tokenize(`title = "open`)).toEqual({
      ok: false,
      errors: [
        {
          code: "query.unterminated_string",
          column: 9,
          message: 'string opened with " is never closed',
        },
      ],
    });
    // A trailing backslash escapes nothing and the string is still open.
    expect(tokenize("title = 'x\\")).toMatchObject({
      ok: false,
      errors: [{ code: "query.unterminated_string", column: 9 }],
    });
  });

  it("fails on a lone `!` at its position", () => {
    expect(tokenize("a ! b")).toEqual({
      ok: false,
      errors: [
        { code: "query.invalid_character", column: 3, message: "`!` must be followed by `=`" },
      ],
    });
  });
});
