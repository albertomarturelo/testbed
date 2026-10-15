import { describe, expect, it } from "vitest";
import { run } from "./cli.js";

describe("casefile cli", () => {
  it("prints usage with no arguments", () => {
    const result = run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: casefile <command>");
  });

  it("prints the package version", () => {
    const result = run(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects unknown commands with exit code 1", () => {
    const result = run(["frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown command 'frobnicate'");
  });
});
