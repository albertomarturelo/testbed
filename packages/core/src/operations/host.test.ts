import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_ROOT } from "../demo.fixture.js";
import { openRegistry } from "./host.js";
import { CORE_PACKAGE_DIR } from "./spec.js";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-host-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

/** A duck-typed operation, as in extensions.test.ts: no zod inside the temp dir. */
const operation = (name: string, spec: string) => `{
  name: "${name}",
  input: { safeParse: (data) => ({ success: true, data }) },
  output: { safeParse: (data) => ({ success: true, data }) },
  actor: ["human"],
  writes: [],
  spec: "${spec}",
  async run(input) { return { ok: true, value: input }; },
}`;

async function installExtension(name: string, operations: string[]) {
  const dir = `.casefile/node_modules/${name}`;
  await put(`${dir}/package.json`, JSON.stringify({ name, version: "1.0.0", type: "module" }));
  await put(
    `${dir}/index.js`,
    `export const manifest = { operations: [${operations.join(", ")}] };`,
  );
}

describe("openRegistry", () => {
  it("has the built-ins and their SPECs without a workspace", async () => {
    const host = await openRegistry(null);
    expect(host.registry.list().map((o) => o.name)).toEqual([
      "id-next",
      "init",
      "overview",
      "project-add",
      "query",
      "resolve",
      "validate",
    ]);
    expect(host.specs.get("init")).toBe(join(CORE_PACKAGE_DIR, "specs/init.md"));
    expect(host).toMatchObject({ config: null, errors: [] });
  });

  it("reads casefile.yaml in a workspace", async () => {
    const host = await openRegistry(DEMO_ROOT);
    expect(host.errors).toEqual([]);
    expect(host.config?.projects).toEqual([{ name: "web", path: "." }]);
  });

  it("registers extension operations with SPECs resolved in their package", async () => {
    await put("casefile.yaml", "version: 1\nprojects: []\nextensions: ['@acme/hello']\n");
    await installExtension("@acme/hello", [
      operation("hello", "specs/hello.md"),
      operation("escape", "../../../../etc/passwd"),
      operation("init", "specs/init.md"),
    ]);
    const host = await openRegistry(root);
    expect(host.registry.list().map((o) => o.name)).toEqual([
      "escape",
      "hello",
      "id-next",
      "init",
      "overview",
      "project-add",
      "query",
      "resolve",
      "validate",
    ]);
    expect(host.specs.get("hello")).toBe(
      join(root, ".casefile/node_modules/@acme/hello/specs/hello.md"),
    );
    // A SPEC outside the package is never indexed; a clashing name keeps core's.
    expect(host.specs.has("escape")).toBe(false);
    expect(host.specs.get("init")).toBe(join(CORE_PACKAGE_DIR, "specs/init.md"));
    expect(host.errors.map((e) => e.code)).toEqual(["operation.duplicate"]);
  });

  it("reports an unreadable config or a missing extension as errors, keeping the built-ins", async () => {
    await put("casefile.yaml", "version: 2\n");
    const broken = await openRegistry(root);
    expect(broken.config).toBeNull();
    expect(broken.errors.length).toBeGreaterThan(0);
    expect(broken.registry.get("validate")).toBeDefined();

    await put("casefile.yaml", "version: 1\nprojects: []\nextensions: ['@acme/absent']\n");
    const missing = await openRegistry(root);
    expect(missing.errors.map((e) => e.code)).toEqual(["extension.not_installed"]);
  });

  it("treats a missing casefile.yaml as an empty workspace", async () => {
    const host = await openRegistry(root);
    expect(host).toMatchObject({ config: null, errors: [] });
  });
});
