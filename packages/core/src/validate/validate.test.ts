import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEMO_MONOREPO_ROOT, DEMO_ROOT } from "../demo.fixture.js";
import { loadWorkspace } from "../load/workspace.js";
import { builtinOperations } from "../operations/builtins.js";
import { loadToolchain, type Toolchain } from "../operations/extensions.js";
import { createRegistry } from "../operations/registry.js";
import { FINDING_CODES, type Finding, finding } from "./finding.js";
import { type Level, validateWorkspace } from "./validate.js";

const BROKEN = fileURLToPath(new URL("../../fixtures/broken/", import.meta.url));

type Expected = { code: string; path: string; field?: string };

const located = (findings: Finding[]): Expected[] =>
  findings.map(({ code, path, field }) => ({
    code,
    path,
    ...(field === undefined ? {} : { field }),
  }));

const validateAt = async (root: string) => {
  const workspace = await loadWorkspace(root);
  const toolchain = await loadToolchain(root, workspace.config?.extensions ?? []);
  return validateWorkspace({ workspace, toolchain });
};

const put = async (root: string, path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

/** Stands in for `npm install --prefix .casefile`: only `package.json` is read. */
const fakeInstall = (root: string, name: string, version: string) =>
  put(root, `.casefile/node_modules/${name}/package.json`, JSON.stringify({ name, version }));

describe("validateWorkspace on the demos", () => {
  it.each([
    ["examples/demo-repo", DEMO_ROOT],
    ["examples/demo-monorepo", DEMO_MONOREPO_ROOT],
  ])("%s has no findings", async (_, root) => {
    expect(await validateAt(root)).toEqual([]);
  });
});

describe("validateWorkspace on broken workspaces", async () => {
  const cases = (await readdir(BROKEN)).sort();

  it.each(cases)("%s yields exactly its expected codes", async (name) => {
    const root = join(BROKEN, name);
    const expected: Expected[] = JSON.parse(await readFile(join(root, "expected.json"), "utf8"));
    expect(located(await validateAt(root))).toEqual(expected);
  });

  it("covers every code in the catalogue", async () => {
    const seen = new Set<string>();
    for (const name of cases) {
      for (const f of await validateAt(join(BROKEN, name))) seen.add(f.code);
    }
    expect([...seen].sort()).toEqual(Object.keys(FINDING_CODES).sort());
  });

  it("gives every finding a code from the catalogue, its severity, a path and a message", async () => {
    for (const name of cases) {
      for (const f of await validateAt(join(BROKEN, name))) {
        expect(FINDING_CODES).toHaveProperty([f.code]);
        expect(f.severity).toBe(FINDING_CODES[f.code as keyof typeof FINDING_CODES].severity);
        expect(f.path).not.toBe("");
        expect(f.message).not.toBe("");
      }
    }
  });

  it("reports toolchain.unpinned as a warning, so the setup loop can exit 0", async () => {
    const findings = await validateAt(join(BROKEN, "toolchain-unpinned"));
    expect(findings.map((f) => [f.code, f.severity])).toEqual([["toolchain.unpinned", "warning"]]);
  });

  it("is deterministic", async () => {
    for (const name of cases) {
      const root = join(BROKEN, name);
      expect(await validateAt(root)).toEqual(await validateAt(root));
    }
  });
});

describe("init → project add → validate", () => {
  it("reports only the scaffold's pending fields, one scaffold.todo each", async () => {
    const root = await mkdtemp(join(tmpdir(), "casefile-validate-"));
    try {
      const registry = createRegistry();
      for (const operation of builtinOperations) registry.register(operation);
      await registry.invoke("init", { casefileVersion: "0.4.1" }, { root, actor: "human" });
      await mkdir(join(root, "apps/web"), { recursive: true });
      const added = await registry.invoke(
        "project-add",
        { name: "web", path: "apps/web" },
        { root, actor: "agent" },
      );
      expect(added.ok).toBe(true);
      expect((await validateAt(root)).map((f) => f.code)).toContain("toolchain.not_installed");

      await fakeInstall(root, "@casefile/cli", "0.4.1");
      const findings = await validateAt(root);
      expect(findings.map((f) => [f.code, f.path, f.field])).toEqual(
        ["automation.eligible", "layer", "priority", "review.mode", "surfaces"].map((field) => [
          "scaffold.todo",
          "apps/web/context/tests/_common.yaml",
          field,
        ]),
      );
      expect(findings.every((f) => f.hint !== undefined)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("environment level", () => {
  const withWorkspace = async (test: (root: string) => Promise<void>) => {
    const root = await mkdtemp(join(tmpdir(), "casefile-validate-"));
    try {
      await put(root, "casefile.yaml", "version: 1\nprojects: [{ name: web, path: . }]\n");
      await put(root, "context/tests/_common.yaml", "layer: e2e\n");
      await test(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
  const pin = (root: string, version: string) =>
    put(
      root,
      ".casefile/package.json",
      JSON.stringify({ dependencies: { "@casefile/cli": version } }),
    );

  it("has nothing to check without .casefile/package.json", () =>
    withWorkspace(async (root) => {
      expect(await validateAt(root)).toEqual([]);
    }));

  it("accepts casefile pinned and installed, and an installed extension", () =>
    withWorkspace(async (root) => {
      await put(
        root,
        "casefile.yaml",
        "version: 1\nprojects: [{ name: web, path: . }]\nextensions: ['@acme/commons']\n",
      );
      await pin(root, "0.4.1");
      await fakeInstall(root, "@casefile/cli", "0.4.1");
      await fakeInstall(root, "@acme/commons", "1.0.0");
      expect(await validateAt(root)).toEqual([]);
    }));

  it("warns on a range, and only warns once it is installed", () =>
    withWorkspace(async (root) => {
      await pin(root, "^0.4.1");
      const codes = async () => (await validateAt(root)).map((f) => [f.code, f.severity]);
      expect(await codes()).toEqual([
        ["toolchain.not_installed", "error"],
        ["toolchain.unpinned", "warning"],
      ]);
      await fakeInstall(root, "@casefile/cli", "0.4.2");
      expect(await codes()).toEqual([["toolchain.unpinned", "warning"]]);
    }));

  it("treats an unreadable .casefile/package.json as pinning nothing", () =>
    withWorkspace(async (root) => {
      await put(root, ".casefile/package.json", "{ not json");
      expect((await validateAt(root)).map((f) => f.code)).toEqual(["toolchain.unpinned"]);
      await rm(join(root, ".casefile/package.json"));
      await mkdir(join(root, ".casefile/package.json"));
      expect((await validateAt(root)).map((f) => f.code)).toEqual(["toolchain.unpinned"]);
    }));

  it("reports an install that differs from its exact pin", () =>
    withWorkspace(async (root) => {
      await put(
        root,
        "casefile.yaml",
        "version: 1\nprojects: [{ name: web, path: . }]\nextensions: ['@acme/commons']\n",
      );
      await put(
        root,
        ".casefile/package.json",
        JSON.stringify({ dependencies: { "@casefile/cli": "0.4.1", "@acme/commons": "1.0.0" } }),
      );
      await fakeInstall(root, "@casefile/cli", "0.4.2");
      await fakeInstall(root, "@acme/commons", "0.9.0");
      expect((await validateAt(root)).map((f) => [f.code, f.message])).toEqual([
        [
          "toolchain.not_installed",
          "@casefile/cli 0.4.1 is pinned in .casefile/package.json but 0.4.2 is installed",
        ],
        [
          "extension.not_installed",
          "@acme/commons 1.0.0 is pinned in .casefile/package.json but 0.9.0 is installed",
        ],
      ]);
    }));

  it("gives the install command for a missing extension", () =>
    withWorkspace(async (root) => {
      await put(
        root,
        "casefile.yaml",
        "version: 1\nprojects: [{ name: web, path: . }]\nextensions: ['@acme/commons']\n",
      );
      const [found] = await validateAt(root);
      expect(found?.hint).toBe(
        "npm install --prefix .casefile --ignore-scripts --save-exact @acme/commons",
      );
    }));
});

describe("level runner", async () => {
  const toolchain: Toolchain = { declared: null, installed: {} };
  const input = { workspace: await loadWorkspace(DEMO_MONOREPO_ROOT), toolchain };
  const at = (code: "project.missing" | "schema.invalid", message: string) =>
    finding(code, { path: "casefile.yaml", message });
  const warn = (message: string): Finding => ({
    ...at("schema.invalid", message),
    severity: "warning",
  });
  const record = (name: string, log: string[]): Level => ({
    name,
    workspace: () => {
      log.push(`${name}:workspace`);
      return [];
    },
    project: ({ entry }) => {
      log.push(`${name}:${entry.name}`);
      return [];
    },
  });

  it("stops every later level after a workspace error", () => {
    const log: string[] = [];
    const findings = validateWorkspace(input, [
      { name: "first", workspace: () => [at("project.missing", "boom")] },
      record("second", log),
    ]);
    expect(findings.map((f) => f.message)).toEqual(["boom"]);
    expect(log).toEqual([]);
  });

  it("stops the later levels only for the project with an error", () => {
    const log: string[] = [];
    validateWorkspace(input, [
      {
        name: "first",
        project: ({ entry }) => (entry.name === "web" ? [at("project.missing", "web")] : []),
      },
      record("second", log),
    ]);
    expect(log).toEqual(["second:workspace", "second:api"]);
  });

  it("keeps running after warnings", () => {
    const log: string[] = [];
    const findings = validateWorkspace(input, [
      { name: "first", workspace: () => [warn("w")], project: () => [warn("p")] },
      record("second", log),
    ]);
    expect(findings.map((f) => f.severity)).toEqual(["warning", "warning", "warning"]);
    expect(log).toEqual(["second:workspace", "second:web", "second:api"]);
  });

  it("orders findings level by level, then by location", () => {
    const findings = validateWorkspace(input, [
      {
        name: "first",
        workspace: () => [
          warn("b"),
          { ...warn("a"), path: "apps/web/x.yaml", line: 3 },
          { ...warn("c"), path: "apps/web/x.yaml", line: 1 },
        ],
      },
      { name: "second", workspace: () => [{ ...warn("d"), path: "a.yaml" }] },
    ]);
    expect(findings.map((f) => f.message)).toEqual(["c", "a", "b", "d"]);
  });
});
