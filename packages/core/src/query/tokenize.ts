import { type CasefileError, fail, ok, type Result } from "../errors.js";

export type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";

/**
 * A lexical token of the query DSL (see `specs/query-grammar.md`). `start` is the 0-based
 * offset of its first character in the query text.
 */
export type Token =
  | { kind: "word"; text: string; start: number }
  | { kind: "string"; text: string; value: string; start: number }
  | { kind: "operator"; text: ComparisonOperator; start: number }
  | { kind: "lparen" | "rparen" | "comma"; text: string; start: number }
  | { kind: "end"; text: ""; start: number };

const PUNCTUATION = { "(": "lparen", ")": "rparen", ",": "comma" } as const;

/** Characters that end a word: whitespace, punctuation, quotes and operator characters. */
const WORD_BREAK = /[\s(),"'=!<>]/;

/** Splits a query into tokens, ending with an `end` token at the text length. */
export function tokenize(text: string): Result<Token[]> {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    if (/\s/.test(char)) {
      i++;
    } else if (char === "(" || char === ")" || char === ",") {
      tokens.push({ kind: PUNCTUATION[char], text: char, start: i });
      i++;
    } else if (char === '"' || char === "'") {
      const string = readString(text, i);
      if (!string.ok) return string;
      tokens.push(string.value);
      i += string.value.text.length;
    } else if (char === "<" || char === ">" || char === "=" || char === "!") {
      const pair = text.slice(i, i + 2);
      const operator = pair === "<=" || pair === ">=" || pair === "!=" ? pair : char;
      if (operator === "!") {
        return fail(queryError("query.invalid_character", i, "`!` must be followed by `=`"));
      }
      tokens.push({ kind: "operator", text: operator as ComparisonOperator, start: i });
      i += operator.length;
    } else {
      const start = i;
      while (i < text.length && !WORD_BREAK.test(text.charAt(i))) i++;
      tokens.push({ kind: "word", text: text.slice(start, i), start });
    }
  }
  tokens.push({ kind: "end", text: "", start: text.length });
  return ok(tokens);
}

/** Reads a quoted string starting at `start`; `\` escapes the next character. */
function readString(text: string, start: number): Result<Token> {
  const quote = text.charAt(start);
  let value = "";
  let i = start + 1;
  while (i < text.length) {
    const char = text.charAt(i);
    if (char === quote) {
      return ok({ kind: "string", text: text.slice(start, i + 1), value, start });
    }
    if (char === "\\" && i + 1 < text.length) {
      value += text.charAt(i + 1);
      i += 2;
    } else {
      value += char;
      i++;
    }
  }
  return fail(
    queryError("query.unterminated_string", start, `string opened with ${quote} is never closed`),
  );
}

/** A DSL error positioned at a 0-based offset of the query text. */
export function queryError(code: string, offset: number, message: string): CasefileError {
  return { code, column: offset + 1, message };
}
