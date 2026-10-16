import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Result } from "../errors.js";
import { loadWorkspace } from "../load/workspace.js";
import { Layer, Priority, ReviewMode, Surface } from "../schema/index.js";
import { builtinOperations } from "./builtins.js";
import { COMMON_SCAFFOLD, type projectAddOperation } from "./project-add.js";
import { createRegistry } from "./registry.js";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-project-add-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};
const read = (path: string) => readFile(join(root, path), "utf8");

const registry = createRegistry();
for (const operation of builtinOperations) registry.register(operation);
const init = () => registry.invoke("init", { casefileVersion: "0.4.1" }, { root, actor: "human" });
const add = (name: string, path: string) =>
  registry.invoke("project-add", { name, path }, { root, actor: "agent" }) as Promise<
    Result<z.infer<typeof projectAddOperation.output>>
  >;
const codes = async (name: string, path: string) => {
  const result = await add(name, path);
  return result.ok ? [] : result.errors.map((e) => e.code);
};

/** The fields `project add` leaves pending, as `_common.yaml` dotted paths. */
const TODO_FIELDS = ["automation.eligible", "layer", "priority", "review.mode", "surfaces"];

describe("init → project add → load", () => {
  it("yields a workspace whose only gaps are the TODO fields", async () => {
    await init();
    await mkdir(join(root, "apps/web"), { recursive: true });
    await mkdir(join(root, "apps/api"), { recursive: true });
    expect((await add("web", "apps/web/")).ok).toBe(true);
    expect((await add("api", "apps/api")).ok).toBe(true);

    const workspace = await loadWorkspace(root);
    expect(workspace.config?.projects).toEqual([
      { name: "web", path: "apps/web" },
      { name: "api", path: "apps/api" },
    ]);
    expect(workspace.projects.map((p) => p.name)).toEqual(["web", "api"]);
    // Each marker is reported as `scaffold.todo` on its field, and nothing else is.
    for (const project of ["apps/web", "apps/api"]) {
      const errors = workspace.errors.filter((e) => e.path?.startsWith(`${project}/`));
      expect(errors.every((e) => e.code === "scaffold.todo")).toBe(true);
      expect(errors.map((e) => e.path)).toEqual(
        TODO_FIELDS.map(() => `${project}/context/tests/_common.yaml`),
      );
      expect(errors.map((e) => e.field).sort()).toEqual(TODO_FIELDS);
    }
    expect(workspace.errors).toHaveLength(TODO_FIELDS.length * 2);
  });

  it("lists each enum's allowed values from the schema", () => {
    for (const options of [Surface.options, Layer.options, Priority.options, ReviewMode.options]) {
      expect(COMMON_SCAFFOLD).toContain(options.join(", "));
    }
  });

  it("scaffolds a single-project repo at `.`", async () => {
    await init();
    const result = await add("app", ".");
    expect(result).toEqual({
      ok: true,
      value: {
        name: "app",
        path: ".",
        created: [
          "casefile.yaml",
          "context/tests/_common.yaml",
          "context/tests/.runs/.gitkeep",
          "context/tests/.inbox/.gitkeep",
        ],
      },
    });
    expect((await stat(join(root, "context/tests/.runs"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "context/tests/.inbox"))).isDirectory()).toBe(true);
  });
});

describe("project add", () => {
  it("is a no-op with the same arguments", async () => {
    await init();
    await add("app", ".");
    const config = await read("casefile.yaml");
    const result = await add("app", "./");
    expect(result.ok && result.value.created).toEqual([]);
    expect(await read("casefile.yaml")).toBe(config);
  });

  it("keeps comments and key order in casefile.yaml", async () => {
    await put(
      "casefile.yaml",
      [
        "# our workspace",
        "version: 1 # format",
        "extensions:",
        '  - "@acme/casefile-org" # org commons',
        "projects:",
        "  # the web app",
        "  - name: web",
        "    path: apps/web",
        "commons:",
        "  labels: { team: qa }",
        "",
      ].join("\n"),
    );
    await mkdir(join(root, "apps/api"), { recursive: true });
    expect((await add("api", "apps/api")).ok).toBe(true);
    expect(await read("casefile.yaml")).toBe(
      [
        "# our workspace",
        "version: 1 # format",
        "extensions:",
        '  - "@acme/casefile-org" # org commons',
        "projects:",
        "  # the web app",
        "  - name: web",
        "    path: apps/web",
        "  - name: api",
        "    path: apps/api",
        "commons:",
        "  labels: { team: qa }",
        "",
      ].join("\n"),
    );
  });

  it("fills a scaffold file that went missing, and never overwrites one", async () => {
    await init();
    await add("app", ".");
    await put("context/tests/_common.yaml", "surfaces: [web]\n");
    await rm(join(root, "context/tests/.inbox"), { recursive: true });
    const result = await add("app", ".");
    expect(result.ok && result.value.created).toEqual(["context/tests/.inbox/.gitkeep"]);
    expect(await read("context/tests/_common.yaml")).toBe("surfaces: [web]\n");
  });

  it("refuses a name or path that clashes with another project", async () => {
    await init();
    for (const dir of ["apps/web", "apps/web/admin", "apps/api"]) {
      await mkdir(join(root, dir), { recursive: true });
    }
    await add("web", "apps/web");
    expect(await codes("web", "apps/api")).toEqual(["project.name_taken"]);
    expect(await codes("site", "apps/web")).toEqual(["project.path_taken"]);
    expect(await codes("admin", "apps/web/admin")).toEqual(["project.nested"]);
    expect(await codes("all", ".")).toEqual(["project.nested"]);
    expect(await read("casefile.yaml")).not.toContain("apps/api");
  });

  it("refuses paths outside the workspace or missing", async () => {
    await init();
    expect(await codes("up", "../elsewhere")).toEqual(["project.outside_workspace"]);
    expect(await codes("abs", "/tmp/x")).toEqual(["project.outside_workspace"]);
    expect(await codes("ghost", "apps/ghost")).toEqual(["project.missing"]);
  });

  it("needs casefile.yaml from init, and a readable one", async () => {
    expect(await codes("app", ".")).toEqual(["config.missing"]);
    await put("casefile.yaml", "version: 1\nprojects: [\n");
    expect(await codes("app", ".")).toEqual(["yaml.invalid"]);
    await put("casefile.yaml", "version: 2\nprojects: []\n");
    expect(await codes("app", ".")).toEqual(["schema.invalid"]);
  });

  it("rejects a name that is not a slug", async () => {
    await init();
    expect(await codes("Web App", ".")).toEqual(["operation.invalid_input"]);
  });

  it("is an agent operation", async () => {
    await init();
    const result = await registry.invoke(
      "project-add",
      { name: "app", path: "." },
      { root, actor: "human" },
    );
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual([
      "operation.actor_not_allowed",
    ]);
  });
});
