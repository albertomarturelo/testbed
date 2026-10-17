import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_PACKAGE_DIR, CORE_SPECS_DIR, readSpec, specFile, specSummary } from "./spec.js";

describe("specFile", () => {
  it("resolves inside the declaring package only", () => {
    expect(specFile("/pkg", { spec: "specs/cover.md" })).toBe(join("/pkg", "specs/cover.md"));
    expect(specFile("/pkg", { spec: "../other/specs/x.md" })).toBeNull();
    expect(specFile("/pkg", { spec: "/etc/passwd" })).toBeNull();
    expect(specFile("/pkg", { spec: "." })).toBeNull();
  });
});

describe("readSpec", () => {
  const specs = new Map([["init", join(CORE_PACKAGE_DIR, "specs/init.md")]]);

  it("reads a registered operation's SPEC", async () => {
    const result = await readSpec(specs, "init");
    expect(result.ok && result.value.startsWith("# init\n")).toBe(true);
  });

  it("falls back to a core topic in specs/", async () => {
    const result = await readSpec(new Map(), "validate");
    expect(result.ok && result.value.startsWith("# validate\n")).toBe(true);
    expect(CORE_SPECS_DIR).toBe(join(CORE_PACKAGE_DIR, "specs"));
  });

  it("fails with spec.unknown for unknown names and never leaves specs/", async () => {
    for (const name of ["nope", "../README", "Init"]) {
      expect(await readSpec(specs, name)).toEqual({
        ok: false,
        errors: [{ code: "spec.unknown", message: `no operation or topic SPEC named '${name}'` }],
      });
    }
    // A registered path that does not exist is unknown too, not a throw.
    expect(await readSpec(new Map([["gone", "/no/such/spec.md"]]), "gone")).toMatchObject({
      ok: false,
    });
  });
});

describe("specSummary", () => {
  it("joins the first paragraph after the title", () => {
    expect(specSummary("# init\n\nCreates the files.\nRun once.\n\n- **Actor:** human\n")).toBe(
      "Creates the files. Run once.",
    );
    expect(specSummary("# x\n\nOne line at the end")).toBe("One line at the end");
  });

  it("is empty when there is no paragraph", () => {
    expect(specSummary("# only a title\n\n## Input\n")).toBe("");
  });
});
