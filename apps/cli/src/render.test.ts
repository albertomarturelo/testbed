import { describe, expect, it } from "vitest";
import { renderErrors, renderValue } from "./render.js";

describe("renderValue", () => {
  it("prints scalars, lists, nested objects and records, with next last", () => {
    expect(
      renderValue({
        next: ["Do this", "Then that"],
        name: "web",
        count: 2,
        ok: true,
        empty: [],
        files: ["a", "b"],
        nested: { depth: 1, deeper: { x: null } },
        rows: [{ id: "TC-0001", tags: ["x"] }, "loose"],
      }),
    ).toBe(
      [
        "name: web",
        "count: 2",
        "ok: true",
        "empty: (none)",
        "files:",
        "  - a",
        "  - b",
        "nested:",
        "  depth: 1",
        "  deeper:",
        "    x: null",
        "rows:",
        "  -",
        "    id: TC-0001",
        "    tags:",
        "      - x",
        "  - loose",
        "",
        "Next:",
        "  - Do this",
        "  - Then that",
      ].join("\n"),
    );
  });

  it("prints a list of diagnostics as diagnostic lines", () => {
    expect(
      renderValue({
        findings: [
          {
            code: "toolchain.unpinned",
            severity: "warning",
            path: ".casefile/package.json",
            message: "m",
          },
        ],
      }),
    ).toBe("findings:\n  warning  toolchain.unpinned  .casefile/package.json  m");
  });

  it("prints multi-line text as an indented block, and keeps it out of tables", () => {
    expect(
      renderValue({
        runs: [{ status: "failed", note: "Error: timed out\n\n  at login.spec.ts:18" }],
      }),
    ).toBe(
      [
        "runs:",
        "  -",
        "    status: failed",
        "    note: |",
        "      Error: timed out",
        "",
        "        at login.spec.ts:18",
      ].join("\n"),
    );
  });

  it("prints a non-object value as is", () => {
    expect(renderValue("text")).toBe("text");
    expect(renderValue([1, 2])).toBe("[1,2]");
  });
});

describe("renderValue tables", () => {
  it("prints a list of flat records as aligned columns with a header", () => {
    expect(
      renderValue({
        cases: [
          { ref: "web/TC-0003", state: "active", title: "Pay" },
          { ref: "web/TC-0010", state: "draft", extra: true, title: "Refund" },
        ],
      }),
    ).toBe(
      [
        "cases:",
        "  ref          state   title   extra",
        "  web/TC-0003  active  Pay",
        "  web/TC-0010  draft   Refund  true",
      ].join("\n"),
    );
  });
});

describe("renderErrors", () => {
  it("prints location, field, hint and counts for findings", () => {
    expect(
      renderErrors([
        {
          code: "a.b",
          severity: "error",
          path: "x.md",
          line: 3,
          column: 2,
          field: "f",
          message: "bad",
          hint: "fix",
        },
        { code: "c.d", severity: "warning", path: "y", message: "meh" },
      ] as never),
    ).toBe(
      [
        "error  a.b  x.md:3:2 [f]  bad",
        "  hint: fix",
        "warning  c.d  y  meh",
        "",
        "1 error, 1 warning",
      ].join("\n"),
    );
  });

  it("pluralises counts and omits them for plain errors", () => {
    const findings = [
      { code: "a", severity: "error", path: "p", message: "m" },
      { code: "b", severity: "error", path: "p", message: "m" },
    ];
    expect(renderErrors(findings as never).endsWith("2 errors, 0 warnings")).toBe(true);
    expect(renderErrors([{ code: "cli.usage", message: "nope" }])).toBe("error  cli.usage  nope");
  });

  it("draws a caret under the column of a one-line input the error names", () => {
    const error = { code: "query.x", column: 3, field: "query", message: "m" };
    expect(renderErrors([error], { query: "a = (" })).toBe(
      ["error  query.x  column 3 [query]  m", "  a = (", "    ^"].join("\n"),
    );
    // No caret for a file error, a non-text or multi-line input, or a missing field.
    expect(renderErrors([{ ...error, path: "f.md" }], { query: "a" })).not.toContain("^");
    expect(renderErrors([error], { query: "a\nb" })).not.toContain("^");
    // A tab prints as one space so the caret stays under its column.
    expect(renderErrors([error], { query: "\t= (" })).toBe(
      ["error  query.x  column 3 [query]  m", "   = (", "    ^"].join("\n"),
    );
    expect(renderErrors([error], { query: 3 })).not.toContain("^");
    expect(renderErrors([{ code: "x", column: 2, message: "m" }], { query: "ab" })).not.toContain(
      "^",
    );
  });
});
