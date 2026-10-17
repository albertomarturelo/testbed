import { fail, ok, type Result } from "../errors.js";
import { type ComparisonOperator, queryError, type Token, tokenize } from "./tokenize.js";

/** Roots of context variables; any other path reads the case (ADR single-query-dsl). */
export const CONTEXT_ROOTS = ["release"] as const;

/**
 * A dotted path: a field of the case, or a context variable (`release.build`)
 * when its first segment is a context root. `start` is a 0-based offset.
 */
export type QueryPath = {
  kind: "field" | "variable";
  segments: string[];
  text: string;
  start: number;
};

/**
 * A literal. A bare word keeps its `text`: it is typed as boolean or number when
 * it reads as one, and still equals a string field with the same text. A quoted
 * string has no `text` and only ever is a string.
 */
export type QueryLiteral = {
  kind: "literal";
  value: string | number | boolean;
  text?: string;
  start: number;
};

export type QueryValue = QueryLiteral | QueryPath;

/** The typed AST of a query; every node carries the 0-based offset where it starts. */
export type QueryNode =
  | { kind: "and" | "or"; left: QueryNode; right: QueryNode; start: number }
  | { kind: "not"; operand: QueryNode; start: number }
  | {
      kind: "compare";
      operator: ComparisonOperator;
      path: QueryPath;
      value: QueryValue;
      start: number;
    }
  | { kind: "in"; path: QueryPath; list: QueryValue[] | QueryPath; start: number }
  | { kind: "contains"; path: QueryPath; value: QueryValue; start: number };

const KEYWORDS = new Set(["AND", "OR", "NOT", "IN", "CONTAINS"]);

const PATH = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

const NUMBER = /^-?\d+(\.\d+)?$/;

/** Most nested `NOT` / `(` a query may hold, so hostile input fails as a value, not a stack overflow. */
export const MAX_QUERY_DEPTH = 64;

/** Parses a query into its AST (grammar: GRAMMAR.md). Errors carry a 1-based `column`. */
export function parseQuery(text: string): Result<QueryNode> {
  const tokens = tokenize(text);
  if (!tokens.ok) return tokens;
  try {
    const parser = new Parser(tokens.value);
    const node = parser.or();
    parser.expectEnd();
    return ok(node);
  } catch (error) {
    if (error instanceof SyntaxFailure) return fail(error.error);
    throw error;
  }
}

/**
 * The operands of a run of the same `AND` / `OR`, in source order. Chains are
 * left-deep, so walking them iteratively keeps recursion bounded by nesting.
 */
export function chain(node: QueryNode & { kind: "and" | "or" }): QueryNode[] {
  const operands: QueryNode[] = [];
  let current: QueryNode = node;
  while (current.kind === node.kind && (current.kind === "and" || current.kind === "or")) {
    operands.push(current.right);
    current = current.left;
  }
  operands.push(current);
  return operands.reverse();
}

/** Every context variable a query reads, in source order. */
export function queryVariables(node: QueryNode): QueryPath[] {
  switch (node.kind) {
    case "and":
    case "or":
      return chain(node).flatMap(queryVariables);
    case "not":
      return queryVariables(node.operand);
    case "in":
      return [node.path, ...(Array.isArray(node.list) ? node.list : [node.list])].filter(
        isVariable,
      );
    case "compare":
    case "contains":
      return [node.path, node.value].filter(isVariable);
  }
}

function isVariable(value: QueryValue): value is QueryPath {
  return value.kind === "variable";
}

/** Unwinds the recursive descent on the first syntax error; never escapes `parseQuery`. */
class SyntaxFailure extends Error {
  constructor(readonly error: ReturnType<typeof queryError>) {
    super(error.message);
  }
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  /** or := and ("OR" and)* */
  or(): QueryNode {
    let left = this.and();
    while (this.keyword("OR")) {
      this.index++;
      left = { kind: "or", left, right: this.and(), start: left.start };
    }
    return left;
  }

  /** and := not ("AND" not)* */
  private and(): QueryNode {
    let left = this.not();
    while (this.keyword("AND")) {
      this.index++;
      left = { kind: "and", left, right: this.not(), start: left.start };
    }
    return left;
  }

  /** not := "NOT" not | primary */
  private not(): QueryNode {
    if (this.keyword("NOT")) {
      const token = this.next();
      return this.nested(token, () => ({ kind: "not", operand: this.not(), start: token.start }));
    }
    return this.primary();
  }

  /** primary := "(" or ")" | predicate */
  private primary(): QueryNode {
    if (this.peek().kind === "lparen") {
      return this.nested(this.next(), () => {
        const node = this.or();
        this.expect("rparen", "`)`");
        return node;
      });
    }
    return this.predicate();
  }

  /** predicate := path (operator value | "IN" list | "CONTAINS" value) */
  private predicate(): QueryNode {
    const path = this.path();
    const token = this.peek();
    if (token.kind === "operator") {
      this.index++;
      return {
        kind: "compare",
        operator: token.text,
        path,
        value: this.value(),
        start: path.start,
      };
    }
    if (this.keyword("IN")) {
      this.index++;
      return { kind: "in", path, list: this.list(), start: path.start };
    }
    if (this.keyword("CONTAINS")) {
      this.index++;
      return { kind: "contains", path, value: this.value(), start: path.start };
    }
    throw this.unexpected(token, "an operator, IN or CONTAINS");
  }

  /** list := "(" value ("," value)* ")" | variable */
  private list(): QueryValue[] | QueryPath {
    const token = this.peek();
    if (token.kind !== "lparen") {
      const path = token.kind === "word" ? toPath(token) : null;
      if (path?.kind !== "variable")
        throw this.unexpected(token, "`(` or a context variable after IN");
      this.index++;
      return path;
    }
    this.index++;
    const values = [this.value()];
    while (this.peek().kind === "comma") {
      this.index++;
      values.push(this.value());
    }
    this.expect("rparen", "`,` or `)`");
    return values;
  }

  /** value := string | word (a context variable, boolean, number or bare string) */
  private value(): QueryValue {
    const token = this.peek();
    if (token.kind === "string") {
      this.index++;
      return { kind: "literal", value: token.value, start: token.start };
    }
    if (token.kind !== "word" || this.isKeyword(token)) throw this.unexpected(token, "a value");
    this.index++;
    const path = toPath(token);
    if (path?.kind === "variable") return path;
    return { kind: "literal", value: typed(token.text), text: token.text, start: token.start };
  }

  private path(): QueryPath {
    const token = this.peek();
    const path = token.kind === "word" && !this.isKeyword(token) ? toPath(token) : null;
    if (path === null) throw this.unexpected(token, "a field path");
    this.index++;
    return path;
  }

  expectEnd(): void {
    const token = this.peek();
    if (token.kind !== "end") throw this.unexpected(token, "AND, OR or the end of the query");
  }

  private expect(kind: Token["kind"], expected: string): void {
    const token = this.peek();
    if (token.kind !== kind) throw this.unexpected(token, expected);
    this.index++;
  }

  private nested<T>(token: Token, parse: () => T): T {
    if (this.depth === MAX_QUERY_DEPTH) {
      throw new SyntaxFailure(
        queryError(
          "query.too_deep",
          token.start,
          `query nests NOT and parentheses deeper than ${MAX_QUERY_DEPTH} levels`,
        ),
      );
    }
    this.depth++;
    try {
      return parse();
    } finally {
      this.depth--;
    }
  }

  private keyword(name: string): boolean {
    const token = this.peek();
    return token.kind === "word" && token.text.toUpperCase() === name;
  }

  private isKeyword(token: Token): boolean {
    return KEYWORDS.has(token.text.toUpperCase());
  }

  private peek(): Token {
    // The token list always ends with `end`, and nothing advances past it.
    return this.tokens[this.index] as Token;
  }

  private next(): Token {
    const token = this.peek();
    this.index++;
    return token;
  }

  private unexpected(token: Token, expected: string): SyntaxFailure {
    if (token.kind === "end") {
      return new SyntaxFailure(
        queryError("query.unexpected_end", token.start, `expected ${expected}, but the query ends`),
      );
    }
    return new SyntaxFailure(
      queryError(
        "query.unexpected_token",
        token.start,
        `expected ${expected}, found \`${token.text}\``,
      ),
    );
  }
}

function toPath(token: Token): QueryPath | null {
  if (!PATH.test(token.text)) return null;
  const segments = token.text.split(".");
  const root = segments[0] as string;
  const isContext = (CONTEXT_ROOTS as readonly string[]).includes(root) && segments.length > 1;
  return { kind: isContext ? "variable" : "field", segments, text: token.text, start: token.start };
}

function typed(text: string): string | number | boolean {
  if (text === "true") return true;
  if (text === "false") return false;
  if (NUMBER.test(text)) return Number(text);
  return text;
}
