import { describe, expect, it } from "vitest";
import { normalizeProjectPath } from "./paths.js";

describe("normalizeProjectPath", () => {
  it.each([
    ["apps/web", "apps/web"],
    ["apps/web/", "apps/web"],
    ["apps/web//", "apps/web"],
    ["./apps//web", "apps/web"],
    ["apps/./web/../web", "apps/web"],
    [".", "."],
    ["./", "."],
    ["", "."],
    ["../backend/", "../backend"],
    ["/", "/"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeProjectPath(input)).toBe(expected);
  });
});
