import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinOperations } from "./builtins.js";
import { createRegistry } from "./registry.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("builtinOperations", () => {
  it("register cleanly", () => {
    const registry = createRegistry();
    for (const operation of builtinOperations) {
      expect(registry.register(operation)).toEqual({ ok: true, value: undefined });
    }
    expect(registry.list().map((o) => o.name)).toEqual([
      "cover",
      "id-next",
      "ingest-junit",
      "init",
      "overview",
      "project-add",
      "query",
      "resolve",
      "runs",
      "validate",
    ]);
  });

  it.each(builtinOperations.map((o) => [o.name, o.spec]))(
    "%s ships its SPEC at %s",
    async (_, spec) => {
      await expect(access(`${PACKAGE_ROOT}${spec}`)).resolves.toBeUndefined();
    },
  );
});
