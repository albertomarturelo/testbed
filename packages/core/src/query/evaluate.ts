import { fail, ok, type Result } from "../errors.js";
import type { ResolvedCase } from "../resolve/resolve.js";
import {
  parseQuery,
  type QueryLiteral,
  type QueryNode,
  type QueryPath,
  type QueryValue,
  queryVariables,
} from "./parse.js";
import { queryError } from "./tokenize.js";

/** Values of the context variables, keyed by context root (`release.changed_features`, `release.build`). */
export type QueryContext = {
  release?: Record<string, unknown>;
};

/**
 * Whether a case matches a parsed query. Pure and total: a missing field or a
 * type mismatch makes the predicate false, never an error (GRAMMAR.md, semantics).
 * Check the context first with `checkQueryContext`.
 */
export function evaluateQuery(
  node: QueryNode,
  subject: object,
  context: QueryContext = {},
): boolean {
  switch (node.kind) {
    case "and":
      return (
        evaluateQuery(node.left, subject, context) && evaluateQuery(node.right, subject, context)
      );
    case "or":
      return (
        evaluateQuery(node.left, subject, context) || evaluateQuery(node.right, subject, context)
      );
    case "not":
      return !evaluateQuery(node.operand, subject, context);
    case "compare": {
      const actual = read(node.path, subject, context);
      const expected = resolveValue(node.value, subject, context);
      switch (node.operator) {
        case "=":
          return equals(actual, expected);
        case "!=":
          return !equals(actual, expected);
        default:
          return compareOrdered(node.operator, actual, expected);
      }
    }
    case "in": {
      const actual = read(node.path, subject, context);
      const candidates = Array.isArray(node.list)
        ? node.list.map((value) => resolveValue(value, subject, context))
        : asList(read(node.list, subject, context));
      const values = Array.isArray(actual) ? actual : [actual];
      return values.some((value) => candidates.some((candidate) => equals(value, candidate)));
    }
    case "contains": {
      const actual = read(node.path, subject, context);
      const expected = resolveValue(node.value, subject, context);
      if (Array.isArray(actual)) return actual.some((item) => equals(item, expected));
      if (typeof actual !== "string") return false;
      const needle = textOf(expected);
      return needle !== null && actual.includes(needle);
    }
  }
}

/** Fails with `query.unknown_variable` for each context variable the context does not define. */
export function checkQueryContext(node: QueryNode, context: QueryContext): Result<QueryNode> {
  const errors = queryVariables(node)
    .filter((variable) => readPath(context, variable.segments) === undefined)
    .map((variable) =>
      queryError(
        "query.unknown_variable",
        variable.start,
        `context variable \`${variable.text}\` is not defined`,
      ),
    );
  return errors.length === 0 ? ok(node) : fail(...errors);
}

/** Parses a query, checks its context variables and returns the matching cases in their order. */
export function queryCases(
  text: string,
  cases: readonly ResolvedCase[],
  context: QueryContext = {},
): Result<ResolvedCase[]> {
  const parsed = parseQuery(text);
  if (!parsed.ok) return parsed;
  const checked = checkQueryContext(parsed.value, context);
  if (!checked.ok) return checked;
  return ok(cases.filter((c) => evaluateQuery(parsed.value, c, context)));
}

/**
 * A resolved operand: a literal keeps the text of its bare word so it can equal
 * a string field; anything read from the case or the context is a plain value.
 */
type Operand = { literal: QueryLiteral } | { value: unknown };

function resolveValue(value: QueryValue, subject: object, context: QueryContext): Operand {
  return value.kind === "literal" ? { literal: value } : { value: read(value, subject, context) };
}

function read(path: QueryPath, subject: object, context: QueryContext): unknown {
  return path.kind === "variable"
    ? readPath(context, path.segments)
    : readPath(subject, path.segments);
}

/** Walks object keys and array indexes; `undefined` as soon as a segment is missing. */
function readPath(root: unknown, segments: readonly string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment))
      return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asList(value: unknown): Operand[] {
  return Array.isArray(value) ? value.map((item) => ({ value: item })) : [];
}

/** Equality of scalars of the same type; a bare word also equals a string with its exact text. */
function equals(actual: unknown, expected: Operand): boolean {
  if (!isScalar(actual)) return false;
  if ("value" in expected) return actual === expected.value;
  const { value, text } = expected.literal;
  return actual === value || (typeof actual === "string" && actual === text);
}

function compareOrdered(
  operator: "<" | "<=" | ">" | ">=",
  actual: unknown,
  expected: Operand,
): boolean {
  if (typeof actual !== "number" && typeof actual !== "string") return false;
  // A bare word compares as text against a string field (`priority <= P1`, `id < TC-0010`).
  const right =
    "value" in expected
      ? expected.value
      : typeof actual === "string"
        ? (expected.literal.text ?? expected.literal.value)
        : expected.literal.value;
  if (typeof right !== typeof actual) return false;
  const other = right as typeof actual;
  switch (operator) {
    case "<":
      return actual < other;
    case "<=":
      return actual <= other;
    case ">":
      return actual > other;
    case ">=":
      return actual >= other;
  }
}

/** The text a CONTAINS needle matches inside a string field. */
function textOf(expected: Operand): string | null {
  if ("value" in expected) return typeof expected.value === "string" ? expected.value : null;
  return expected.literal.text ?? String(expected.literal.value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
