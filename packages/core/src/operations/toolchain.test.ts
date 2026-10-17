import { describe, expect, it } from "vitest";
import type { Toolchain } from "./extensions.js";
import { notInstalled, toolchainDelegation } from "./toolchain.js";

const toolchain = (declared: Toolchain["declared"], installed: Toolchain["installed"] = {}) => ({
  declared,
  installed,
});

describe("toolchainDelegation", () => {
  it("runs itself when nothing pins casefile", () => {
    expect(toolchainDelegation(null, "1.0.0")).toEqual({ action: "run" });
    expect(toolchainDelegation(toolchain(null), "1.0.0")).toEqual({ action: "run" });
    expect(toolchainDelegation(toolchain({ other: "1.0.0" }), "1.0.0")).toEqual({ action: "run" });
  });

  it("runs itself when the installed pin is the running version", () => {
    expect(
      toolchainDelegation(toolchain({ casefile: "1.0.0" }, { casefile: "1.0.0" }), "1.0.0"),
    ).toEqual({
      action: "run",
    });
  });

  it("delegates to the installed pin when it differs", () => {
    expect(
      toolchainDelegation(toolchain({ casefile: "0.4.1" }, { casefile: "0.4.1" }), "1.0.0"),
    ).toEqual({
      action: "delegate",
      version: "0.4.1",
    });
    // A range pin delegates to whatever is installed.
    expect(
      toolchainDelegation(toolchain({ casefile: "^0.4.0" }, { casefile: "0.4.7" }), "1.0.0"),
    ).toEqual({
      action: "delegate",
      version: "0.4.7",
    });
  });

  it("fails with the install command when the pin is not installed", () => {
    expect(toolchainDelegation(toolchain({ casefile: "0.4.1" }), "1.0.0")).toEqual({
      action: "fail",
      error: {
        code: "toolchain.not_installed",
        path: ".casefile/package.json",
        field: "dependencies.casefile",
        message: "casefile is not installed in .casefile/node_modules; this is casefile 1.0.0",
        hint: expect.stringContaining("npm install --prefix .casefile --ignore-scripts"),
      },
    });
    // A stale install (not at its exact pin) is not installed either.
    expect(
      toolchainDelegation(toolchain({ casefile: "0.4.1" }, { casefile: "0.3.0" }), "1.0.0"),
    ).toMatchObject({
      action: "fail",
      error: {
        message:
          "casefile 0.4.1 is pinned in .casefile/package.json but 0.3.0 is installed; this is casefile 1.0.0",
      },
    });
  });

  it("needs no install when the exact pin is the running version", () => {
    expect(toolchainDelegation(toolchain({ casefile: "1.0.0" }), "1.0.0")).toEqual({
      action: "run",
    });
  });
});

describe("notInstalled", () => {
  it("accepts any installed version for a range pin", () => {
    expect(notInstalled(toolchain({ x: "^1.0.0" }, { x: "1.2.0" }), "x")).toBeNull();
  });
});
