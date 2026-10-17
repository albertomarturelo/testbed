import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEMO_EXPECTED,
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  DEMO_ROOT,
} from "../demo.fixture.js";
import { findWorkspaceRoot, loadProject, loadWorkspace, projectAt } from "./workspace.js";

describe("loadWorkspace on examples/demo-repo (one project at `.`)", async () => {
  const workspace = await loadWorkspace(DEMO_ROOT);
  const [project] = workspace.projects;

  it("loads without errors", () => {
    expect(workspace.errors).toEqual([]);
    expect(workspace.projects.map((p) => [p.name, p.path])).toEqual([[DEMO_EXPECTED.project, "."]]);
  });

  it("loads every case with workspace-relative POSIX paths", () => {
    expect(project?.cases.map((c) => c.file.id).sort()).toEqual([...DEMO_EXPECTED.caseIds]);
    expect(project?.cases.find((c) => c.file.id === "TC-0003")?.path).toBe(
      "context/tests/checkout/payments/TC-0003.md",
    );
  });

  it("loads the commons and the run events", () => {
    for (const path of DEMO_EXPECTED.tc0003CommonsChain) {
      expect(project?.commons.has(path)).toBe(true);
    }
    expect(new Set(project?.runs.map((r) => r.event.run_id)).size).toBe(DEMO_EXPECTED.runFiles);
    expect(Object.keys(project?.properties?.properties ?? {})).toEqual([
      "risk",
      "owner_team",
      "smoke",
    ]);
  });

  it("loads the release policy", () => {
    expect(project?.policy?.gates.map((g) => g.name)).toEqual(Object.keys(DEMO_EXPECTED.gates));
  });
});

describe("loadWorkspace on examples/demo-monorepo (two projects)", async () => {
  const workspace = await loadWorkspace(DEMO_MONOREPO_ROOT);

  it("loads every project in casefile.yaml order without errors", () => {
    expect(workspace.errors).toEqual([]);
    expect(Object.fromEntries(workspace.projects.map((p) => [p.name, p.path]))).toEqual(
      DEMO_MONOREPO_EXPECTED.projects,
    );
    expect(workspace.config?.commons?.labels).toEqual({ owner_team: "platform" });
  });

  it("prefixes every path with the project directory", () => {
    const paths = workspace.projects.flatMap((p) => [
      ...p.cases.map((c) => c.path),
      ...p.commons.keys(),
    ]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path).toMatch(/^(apps\/web|services\/api)\/context\/tests\//);
  });

  it("keeps run events in their own project", () => {
    const runs = Object.fromEntries(
      workspace.projects.map((p) => [p.name, p.runs.map((r) => r.event.run_id)]),
    );
    expect(runs).toEqual({ web: ["2026-10-14-ci-web"], api: ["2026-10-14-ci-api"] });
  });

  it("has no release policy where none is written", () => {
    expect(workspace.projects.map((p) => p.policy)).toEqual([null, null]);
  });
});

describe("loadWorkspace on broken workspaces", () => {
  let root = "";
  const put = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  const fresh = async () => {
    root = await mkdtemp(join(tmpdir(), "casefile-"));
  };
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("reports a missing casefile.yaml and loads nothing", async () => {
    await fresh();
    await put("context/tests/_common.yaml", "layer: e2e\n");
    const workspace = await loadWorkspace(root);
    expect(workspace.errors).toEqual([expect.objectContaining({ code: "config.missing" })]);
    expect(workspace.projects).toEqual([]);
  });

  it("stops at an invalid casefile.yaml", async () => {
    await fresh();
    await put("casefile.yaml", "version: 2\nprojects: []\n");
    const workspace = await loadWorkspace(root);
    expect(workspace.config).toBeNull();
    expect(workspace.errors.map((e) => e.code)).toEqual(["schema.invalid"]);
  });

  it("skips projects that are missing or outside the workspace, and loads the rest", async () => {
    await fresh();
    await put(
      "casefile.yaml",
      [
        "version: 1",
        "projects:",
        "  - { name: gone, path: apps/gone }",
        "  - { name: out, path: ../elsewhere }",
        "  - { name: abs, path: /tmp }",
        "  - { name: file, path: notes.md }",
        "  - { name: web, path: ./apps/web }",
        "",
      ].join("\n"),
    );
    await put("notes.md", "not a directory\n");
    await put("apps/web/context/tests/_common.yaml", "layer: e2e\n");
    const workspace = await loadWorkspace(root);
    expect(workspace.projects.map((p) => [p.name, p.path])).toEqual([["web", "apps/web"]]);
    expect(workspace.errors.map((e) => [e.code, e.field])).toEqual([
      ["project.missing", "projects.0.path"],
      ["project.outside_workspace", "projects.1.path"],
      ["project.outside_workspace", "projects.2.path"],
      ["project.missing", "projects.3.path"],
    ]);
  });

  it("collects errors per file and still loads the rest of a project", async () => {
    await fresh();
    await put("casefile.yaml", "version: 1\nprojects: [{ name: app, path: . }]\n");
    await put("context/tests/_common.yaml", "layer: [\n");
    await put("context/tests/a/TC-0001.md", "no frontmatter\n");
    const run = {
      run_id: "r",
      case_id: "TC-0001",
      status: "passed",
      executor: "ci:x",
      at: "2026-10-15T12:00:00Z",
    };
    await put("context/tests/.runs/r.jsonl", `${JSON.stringify(run)}\n{}\n`);
    await put("context/tests/a/_common.yaml", "layer: e2e\n");
    await put("context/tests/.inbox/abc/in-1.yaml", "ignored: [\n");
    await put("context/tests/a/notes.md", "ignored\n");
    const workspace = await loadWorkspace(root);
    const [project] = workspace.projects;
    expect([...(project?.commons.keys() ?? [])]).toEqual(["context/tests/a/_common.yaml"]);
    expect(project?.runs.map((r) => [r.path, r.line, r.event.run_id])).toEqual([
      ["context/tests/.runs/r.jsonl", 1, "r"],
    ]);
    expect(new Set(workspace.errors.map((e) => `${e.path} ${e.code}`))).toEqual(
      new Set([
        "context/tests/_common.yaml yaml.invalid",
        "context/tests/a/TC-0001.md frontmatter.missing",
        "context/tests/.runs/r.jsonl schema.invalid",
      ]),
    );
  });

  it("loads a project without context/tests as empty", async () => {
    await fresh();
    await put("casefile.yaml", "version: 1\nprojects: [{ name: app, path: . }]\n");
    const workspace = await loadWorkspace(root);
    expect(workspace.errors).toEqual([]);
    expect(workspace.projects[0]?.cases).toEqual([]);
  });

  it("reports an invalid release policy at the project's path", async () => {
    await fresh();
    await put("casefile.yaml", "version: 1\nprojects: [{ name: app, path: apps/app }]\n");
    await put("apps/app/context/releases/policy.yaml", "gates: []\n");
    const workspace = await loadWorkspace(root);
    expect(workspace.projects[0]?.policy).toBeNull();
    expect(workspace.errors.map((e) => `${e.path} ${e.code}`)).toEqual([
      "apps/app/context/releases/policy.yaml schema.invalid",
    ]);
  });
});

describe("project paths as an agent may write them", () => {
  let root = "";
  const put = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("loads `apps/web/` and `./services//api` with normalized paths", async () => {
    root = await mkdtemp(join(tmpdir(), "casefile-"));
    await put(
      "casefile.yaml",
      "version: 1\nprojects:\n  - { name: web, path: apps/web/ }\n  - { name: api, path: ./services//api }\n",
    );
    await put("apps/web/context/tests/_common.yaml", "layer: e2e\n");
    await put("services/api/context/tests/_common.yaml", "layer: api\n");
    const workspace = await loadWorkspace(root);
    expect(workspace.errors).toEqual([]);
    expect(workspace.projects.map((p) => [p.name, p.path, [...p.commons.keys()]])).toEqual([
      ["web", "apps/web", ["apps/web/context/tests/_common.yaml"]],
      ["api", "services/api", ["services/api/context/tests/_common.yaml"]],
    ]);
    const entries = workspace.config?.projects ?? [];
    expect(projectAt(entries, root, join(root, "apps/web/src"))).toBe("web");
    expect(projectAt(entries, root, join(root, "services/api"))).toBe("api");
  });

  it("stores the normalized path when loadProject is called directly", async () => {
    root = await mkdtemp(join(tmpdir(), "casefile-"));
    await put("apps/web/context/tests/_common.yaml", "layer: e2e\n");
    const { value, errors } = await loadProject(root, { name: "web", path: "./apps/web/" });
    expect(errors).toEqual([]);
    expect(value.path).toBe("apps/web");
    expect([...value.commons.keys()]).toEqual(["apps/web/context/tests/_common.yaml"]);
  });
});

describe("findWorkspaceRoot", () => {
  it("walks up from inside a project to the workspace root", async () => {
    const cwd = join(DEMO_MONOREPO_ROOT, "apps/web/context/tests/login");
    const root = await findWorkspaceRoot(cwd);
    expect(root).toEqual({ ok: true, value: resolve(DEMO_MONOREPO_ROOT) });
  });

  it("returns the directory itself when it holds casefile.yaml", async () => {
    expect(await findWorkspaceRoot(DEMO_ROOT)).toEqual({ ok: true, value: resolve(DEMO_ROOT) });
  });

  it("reports workspace.missing outside any workspace", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "casefile-")));
    try {
      const result = await findWorkspaceRoot(dir);
      expect(result.ok || result.errors).toEqual([
        expect.objectContaining({ code: "workspace.missing", path: dir }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("projectAt", () => {
  const projects = [
    { name: "web", path: "apps/web" },
    { name: "api", path: "./services/api" },
  ];
  const root = "/ws";

  it("finds the project containing the directory", () => {
    expect(projectAt(projects, root, "/ws/apps/web")).toBe("web");
    expect(projectAt(projects, root, "/ws/apps/web/context/tests/login")).toBe("web");
    expect(projectAt(projects, root, "/ws/services/api/src")).toBe("api");
  });

  it("returns null at the monorepo root, between projects and outside the workspace", () => {
    expect(projectAt(projects, root, "/ws")).toBeNull();
    expect(projectAt(projects, root, "/ws/apps")).toBeNull();
    expect(projectAt(projects, root, "/ws/apps/website")).toBeNull();
    expect(projectAt(projects, root, "/elsewhere")).toBeNull();
  });

  it("matches a single project at `.` from anywhere in the workspace", () => {
    expect(projectAt([{ name: "app", path: "." }], root, "/ws")).toBe("app");
    expect(projectAt([{ name: "app", path: "." }], root, "/ws/src/deep")).toBe("app");
  });

  it("matches project paths written with a trailing slash", () => {
    expect(projectAt([{ name: "web", path: "apps/web/" }], root, "/ws/apps/web/src")).toBe("web");
    expect(projectAt([{ name: "web", path: "apps/web/" }], root, "/ws/apps/web")).toBe("web");
  });

  it("prefers the most specific project", () => {
    const nested = [{ name: "root", path: "." }, ...projects];
    expect(projectAt(nested, root, "/ws/apps/web/x")).toBe("web");
    expect(projectAt(nested, root, "/ws/docs")).toBe("root");
  });
});
