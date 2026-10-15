import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter.js";

describe("splitFrontmatter", () => {
  it("splits the block between the first two `---` lines", () => {
    const result = splitFrontmatter("a.md", "---\nid: TC-0001\n---\n\nBody\n---\nmore\n");
    expect(result).toEqual({
      ok: true,
      value: { frontmatter: "id: TC-0001", body: "\nBody\n---\nmore\n", frontmatterLine: 2 },
    });
  });

  it("accepts a BOM and CRLF line endings", () => {
    const result = splitFrontmatter("a.md", "﻿---\r\nid: TC-0001\r\n---\r\nBody\r\n");
    expect(result.ok && result.value).toMatchObject({ frontmatter: "id: TC-0001", body: "Body\n" });
  });

  it("accepts an empty block and an empty body", () => {
    expect(splitFrontmatter("a.md", "---\n---")).toEqual({
      ok: true,
      value: { frontmatter: "", body: "", frontmatterLine: 2 },
    });
  });

  it("requires the file to start with `---`", () => {
    const result = splitFrontmatter("a.md", "\n---\nid: TC-0001\n---\n");
    expect(result.ok || result.errors).toEqual([
      expect.objectContaining({ code: "frontmatter.missing", path: "a.md", line: 1 }),
    ]);
  });

  it("requires a closing `---` line", () => {
    const result = splitFrontmatter("a.md", "---\nid: TC-0001\n--- \n");
    expect(result.ok || result.errors).toEqual([
      expect.objectContaining({ code: "frontmatter.unclosed", path: "a.md" }),
    ]);
  });
});
