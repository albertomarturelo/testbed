import { describe, expect, it } from "vitest";
import { nextCaseId } from "./ids.js";

describe("nextCaseId", () => {
  it("starts at TC-0001", () => {
    expect(nextCaseId([])).toBe("TC-0001");
  });

  it("goes one above the highest id, not the count", () => {
    expect(nextCaseId(["TC-0002", "TC-0010", "TC-0003"])).toBe("TC-0011");
  });

  it("grows past four digits", () => {
    expect(nextCaseId(["TC-9999"])).toBe("TC-10000");
  });

  it("ignores strings that are not case ids", () => {
    expect(nextCaseId(["TC-12", "XX-0042", "TC-0005.md", "TC-0004"])).toBe("TC-0005");
  });
});
