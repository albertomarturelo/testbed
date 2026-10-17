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

  it("prints a non-object value as is", () => {
    expect(renderValue("text")).toBe("text");
    expect(renderValue([1, 2])).toBe("[1,2]");
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
});
