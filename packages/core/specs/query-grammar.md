# query-grammar

The full grammar and semantics of the query DSL: one language for UI filters,
collections, gate scopes and `casefile query` (ADR single-query-dsl). Read it
with `casefile spec query-grammar`; the code is in core's `src/query/`.
A query is evaluated on one **resolved** case. Changing this grammar is a
versioned decision: write an ADR first.

## Syntax (EBNF)

```ebnf
query      = or ;
or         = and , { "OR" , and } ;
and        = not , { "AND" , not } ;
not        = "NOT" , not | primary ;
primary    = "(" , or , ")" | predicate ;
predicate  = path , ( operator , value
                    | "IN" , list
                    | "CONTAINS" , value ) ;
list       = "(" , value , { "," , value } , ")" | variable ;
value      = string | variable | word ;
operator   = "=" | "!=" | "<" | "<=" | ">" | ">=" ;

path       = segment , { "." , tail } ;          (* a word of this shape *)
variable   = "release" , "." , tail , { "." , tail } ;
segment    = letter | "_" , { letter | digit | "_" | "-" } ;
tail       = ( letter | digit | "_" | "-" ) , { letter | digit | "_" | "-" } ;

string     = '"' , { char - '"' | "\" , char } , '"'
           | "'" , { char - "'" | "\" , char } , "'" ;
word       = wordchar , { wordchar } ;
wordchar   = char - ( space | "(" | ")" | "," | '"' | "'" | "=" | "!" | "<" | ">" ) ;
```

- Precedence, loosest first: `OR`, `AND`, `NOT`; `AND` and `OR` associate left.
- Keywords (`AND OR NOT IN CONTAINS`) are case-insensitive and never paths or
  values: quote a value that spells one (`labels.mode = 'and'`).
- Whitespace separates tokens and is otherwise ignored; operators need none
  (`priority<=P1`).
- Inside a string, `\` escapes the next character.
- A word is typed: `true` / `false` → boolean, `-?\d+(\.\d+)?` → number,
  `release.<x>` → context variable, anything else → string
  (`TC-0001`, `checkout/payments`, `web-1.2.0+101`, `release:web-1.2.0`).
  A quoted string is always a string.
- `NOT IN` is written `NOT path IN (...)`.
- `NOT` and parentheses nest at most `MAX_QUERY_DEPTH` (64) levels; chains of
  `AND` / `OR` have no length limit.

## Semantics

- **Paths** walk object keys and array indexes of the resolved case
  (`labels.risk`, `automation.status`, `steps.0.do`, `project`). Only own
  properties are read; on an array only an index is (`surfaces.length` is missing).
- **Context variables** read the `QueryContext`. A gate scope gets `release.name`
  (the release without `release:`) and `release.build` (unset when no run of the
  release names a build; ADR release-gate-evaluation). `queryCases` /
  `checkQueryContext` fail with `query.unknown_variable` when one is not defined.
- **Missing fields** (absent, `null`, or a path through a non-object) match no
  predicate: `=`, `<`…, `IN`, `CONTAINS` are false, and `!=` is true.
- **Type mismatches are false, never errors**, because label types vary per key.
  - `=` compares scalars of the same type. A bare word also equals a string
    field with exactly its text (`labels.version = 1.2` matches `"1.2"`). A
    quoted string only equals strings. Arrays and objects equal nothing.
  - `!=` is `NOT (... = ...)`.
  - `< <= > >=` compare two numbers, or two strings by code point
    (`priority <= P1`, ISO timestamps); a bare word compares as text against a
    string field. Anything else is false.
  - `IN` is true when the field (or, for an array field, any element) equals
    one of the list values. A variable that is not an array is an empty list.
  - `CONTAINS` on an array field: some element equals the value; on a string
    field: substring, case-sensitive. Anything else is false.
- Values read from the context compare strictly (no bare-word text).

## Errors

Every error is a `CasefileError` with a stable `code` and a 1-based `column` in
the query text. Parsing stops at the first error.

| Code | When |
|---|---|
| `query.unterminated_string` | a quote is never closed (column of the opening quote) |
| `query.invalid_character` | a `!` not followed by `=` |
| `query.unexpected_token` | a token that does not fit the grammar there |
| `query.unexpected_end` | the query ends where more is required (column = length + 1) |
| `query.too_deep` | `NOT` / `(` nested deeper than `MAX_QUERY_DEPTH` (column of the token that exceeds it) |
| `query.unknown_variable` | a context variable the context does not define |
