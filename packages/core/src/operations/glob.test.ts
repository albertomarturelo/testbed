import { describe, expect, it } from "vitest";
import { matchesGlob } from "./glob.js";

describe("matchesGlob", () => {
  it.each([
    ["casefile.yaml", "casefile.yaml", true],
    ["casefile.yml", "casefile.yaml", false],
    ["context/tests/a/TC-0001.md", "context/tests/**", true],
    ["context/tests/_common.yaml", "context/tests/**", true],
    ["context/tests", "context/tests/**", false],
    ["context/releases/policy.yaml", "context/tests/**", false],
    ["apps/web/context/tests/a/b.md", "**/context/tests/**", true],
    ["context/tests/a/b.md", "**/context/tests/**", true],
    ["apps/web/src/context/tests.md", "**/context/tests/**", false],
    [".casefile/package.json", ".casefile/*", true],
    [".casefile/node_modules/x/package.json", ".casefile/*", false],
    [".casefile/node_modules/x/package.json", ".casefile/**", true],
    ["context/tests/a/TC-0001.md", "context/tests/*/TC-????.md", true],
    ["context/tests/a/TC-00001.md", "context/tests/*/TC-????.md", false],
    ["a.b", "a?b", true],
    ["a/b", "a?b", false],
    ["file(1).md", "file(1).md", true],
    ["fileX1).md", "file(1).md", false],
  ])("%s ~ %s → %s", (path, pattern, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });
});
