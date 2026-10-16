import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ok } from "../errors.js";
import { extensionLayers, loadExtensions, registerExtensions } from "./extensions.js";
import { createRegistry } from "./registry.js";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-ext-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

/** Installs a fake extension package under `base` (`.casefile/node_modules` or `node_modules`). */
async function install(
  base: string,
  name: string,
  version: string,
  source: string,
  pkg: Record<string, unknown> = { exports: "./index.js" },
) {
  const dir = `${base}/${name}`;
  await put(`${dir}/package.json`, JSON.stringify({ name, version, type: "module", ...pkg }));
  await put(`${dir}/${String(pkg.main ?? "index.js")}`, source);
}

// A duck-typed schema keeps the fixture free of a zod install inside the temp dir.
const ECHO_OPERATION = `export const manifest = {
  operations: [{
    name: "echo",
    input: { safeParse: (data) => ({ success: true, data }) },
    output: { safeParse: (data) => ({ success: true, data }) },
    actor: ["agent"],
    writes: [],
    spec: "specs/echo.md",
    async run(input) { return { ok: true, value: input }; },
  }],
  commons: { labels: { org: "acme" }, preconditions: ["VPN is up"] },
};`;

describe("loadExtensions", () => {
  it("loads from .casefile/node_modules with the installed version", async () => {
    await install(".casefile/node_modules", "@acme/casefile-org", "1.2.0", ECHO_OPERATION);
    const { extensions, errors } = await loadExtensions(root, ["@acme/casefile-org"]);
    expect(errors).toEqual([]);
    expect(extensions.map((e) => [e.name, e.version])).toEqual([["@acme/casefile-org", "1.2.0"]]);
    expect(extensions[0]?.manifest.commons).toEqual({
      labels: { org: "acme" },
      preconditions: ["VPN is up"],
    });
  });

  it("ignores a copy in the product's root node_modules", async () => {
    await install("node_modules", "@acme/casefile-org", "9.9.9", ECHO_OPERATION);
    const onlyRoot = await loadExtensions(root, ["@acme/casefile-org"]);
    expect(onlyRoot.extensions).toEqual([]);
    expect(onlyRoot.errors).toEqual([
      {
        code: "extension.not_installed",
        path: "casefile.yaml",
        field: "extensions.0",
        message: "@acme/casefile-org is not installed in .casefile/node_modules",
      },
    ]);

    await install(".casefile/node_modules", "@acme/casefile-org", "1.2.0", ECHO_OPERATION);
    const both = await loadExtensions(root, ["@acme/casefile-org"]);
    expect(both.extensions.map((e) => e.version)).toEqual(["1.2.0"]);
  });

  it("resolves `exports` conditions and `main`", async () => {
    await install(
      ".casefile/node_modules",
      "ext-conditions",
      "1.0.0",
      "export const manifest = {};",
      {
        exports: { ".": { import: "./index.js", require: "./index.cjs" } },
      },
    );
    await install(".casefile/node_modules", "ext-main", "1.0.0", "export const manifest = {};", {
      main: "lib.js",
    });
    await install(
      ".casefile/node_modules",
      "ext-default",
      "1.0.0",
      "export const manifest = {};",
      {},
    );
    const { extensions, errors } = await loadExtensions(root, [
      "ext-conditions",
      "ext-main",
      "ext-default",
    ]);
    expect(errors).toEqual([]);
    expect(extensions.map((e) => e.name)).toEqual(["ext-conditions", "ext-main", "ext-default"]);
  });

  it("reports bad names, entry points, imports and manifests per extension", async () => {
    await install(".casefile/node_modules", "escapes", "1.0.0", "", { exports: "../../evil.js" });
    await install(".casefile/node_modules", "throws", "1.0.0", "throw new Error('boom');");
    await install(".casefile/node_modules", "no-manifest", "1.0.0", "export const other = 1;");
    await install(
      ".casefile/node_modules",
      "bad-ops",
      "1.0.0",
      "export const manifest = { operations: 'x' };",
    );
    await install(
      ".casefile/node_modules",
      "bad-commons",
      "1.0.0",
      "export const manifest = { commons: { layer: 'nope' } };",
    );
    const names = ["../../etc", "escapes", "throws", "no-manifest", "bad-ops", "bad-commons"];
    const { extensions, errors } = await loadExtensions(root, names);
    expect(extensions).toEqual([]);
    expect(errors.map((e) => [e.field, e.code])).toEqual([
      ["extensions.0", "extension.invalid_name"],
      ["extensions.1", "extension.load_failed"],
      ["extensions.2", "extension.load_failed"],
      ["extensions.3", "extension.invalid_manifest"],
      ["extensions.4", "extension.invalid_manifest"],
      ["extensions.5", "extension.invalid_manifest"],
    ]);
    expect(errors[2]?.message).toContain("boom");
  });
});

describe("registerExtensions / extensionLayers", () => {
  it("registers extension operations through the same API and invokes them", async () => {
    await install(".casefile/node_modules", "@acme/casefile-org", "1.2.0", ECHO_OPERATION);
    const { extensions } = await loadExtensions(root, ["@acme/casefile-org"]);
    const registry = createRegistry();
    expect(registerExtensions(registry, extensions)).toEqual([]);
    expect(await registry.invoke("echo", { a: 1 }, { root, actor: "agent" })).toEqual(ok({ a: 1 }));
  });

  it("reports a clash with an already registered operation, naming the extension", async () => {
    await install(".casefile/node_modules", "@acme/casefile-org", "1.2.0", ECHO_OPERATION);
    const { extensions } = await loadExtensions(root, ["@acme/casefile-org"]);
    const registry = createRegistry();
    registerExtensions(registry, extensions);
    expect(registerExtensions(registry, extensions)).toEqual([
      {
        code: "operation.duplicate",
        message: "@acme/casefile-org: an operation named 'echo' is already registered",
      },
    ]);
  });

  it("turns manifest commons into ext:<package>@<version> layers", async () => {
    await install(".casefile/node_modules", "@acme/casefile-org", "1.2.0", ECHO_OPERATION);
    await install(".casefile/node_modules", "no-commons", "2.0.0", "export const manifest = {};");
    const { extensions } = await loadExtensions(root, ["no-commons", "@acme/casefile-org"]);
    expect(extensionLayers(extensions)).toEqual([
      {
        origin: "ext:@acme/casefile-org@1.2.0",
        commons: { labels: { org: "acme" }, preconditions: ["VPN is up"] },
      },
    ]);
  });
});
