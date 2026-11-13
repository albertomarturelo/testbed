import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { dashboardProblems } from "../dashboards/check.js";
import { DEMO_EXPECTED, DEMO_ROOT } from "../demo.fixture.js";
import { AGENT_AUTHOR } from "../git/trailers.js";
import { loadWorkspace } from "../load/workspace.js";
import { queryCases } from "../query/evaluate.js";
import { resolveWorkspace } from "../resolve/resolve.js";
import { Dashboard } from "../schema/index.js";
import { dashboardListOperation } from "./dashboard-list.js";
import { dashboardRemoveOperation } from "./dashboard-remove.js";
import { dashboardSaveOperation } from "./dashboard-save.js";
import { dashboardShowOperation } from "./dashboard-show.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";

const registry = createRegistry();
registry.register(dashboardSaveOperation);
registry.register(dashboardListOperation);
registry.register(dashboardRemoveOperation);
registry.register(dashboardShowOperation);

const DIR = "context/dashboards";
const host = { identity: "qa@acme.example", via: "cli:dashboard-save" };

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-dashboard-"));
  await cp(DEMO_ROOT, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const invoke = (name: string, input: Record<string, unknown>, actor: Actor) =>
  registry.invoke(
    name,
    { ...host, ...(actor === "agent" ? { agent: "claude-code" } : {}), ...input },
    { root, actor },
  );
const save = (slug: string, spec: unknown, actor: Actor = "agent") =>
  invoke("dashboard-save", { slug, spec }, actor);
const remove = (slug: string, actor: Actor = "agent") =>
  invoke("dashboard-remove", { slug }, actor);
const list = async () => {
  const result = await registry.invoke("dashboard-list", {}, { root, actor: "human" });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return (result.value as { dashboards: { slug: string; widgets: number }[] }).dashboards;
};
const text = (slug: string) => readFile(join(root, DIR, `${slug}.yaml`), "utf8");
const codes = (result: Awaited<ReturnType<typeof save>>) =>
  result.ok ? [] : result.errors.map((e) => [e.code, e.field]);

type Saved = {
  path: string;
  created: boolean;
  change: string;
  commit: { author?: string; message: string; files: string[] };
};
const saved = (result: Awaited<ReturnType<typeof save>>): Saved => {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value as Saved;
};

const SPEC = {
  title: "Release",
  widgets: [
    // Keys out of order on purpose: the file has its own order.
    { width: 4, group_by: "last_result", type: "donut", title: "Results", id: "results" },
    { id: "p0", title: "P0", type: "stat", query: "priority = P0" },
  ],
};

describe("the demo's dashboards (ADR dashboards-as-files)", () => {
  it("load, as the oracle says, and are what save would accept", async () => {
    const workspace = await loadWorkspace(DEMO_ROOT);
    const [project] = workspace.projects;
    if (project === undefined) throw new Error("no project");
    const loaded = Object.fromEntries(
      [...project.dashboards].map(([slug, d]) => [slug, d.file.widgets.map((w) => w.id)]),
    );
    expect(loaded).toEqual(DEMO_EXPECTED.dashboards);
    for (const { file } of project.dashboards.values()) {
      expect(dashboardProblems(file, project.milestones)).toEqual([]);
    }
  });

  it("select cases with their queries", async () => {
    const workspace = await loadWorkspace(DEMO_ROOT);
    const { cases } = resolveWorkspace(workspace, { commitFor: () => null });
    const widgets = [...(workspace.projects[0]?.dashboards.values() ?? [])].flatMap(
      (d) => d.file.widgets,
    );
    const variables = { name: "web-1.2.0", build: "web-1.2.0+101" };
    for (const widget of widgets.filter((w) => w.query !== undefined)) {
      const matched = queryCases(widget.query as string, cases, { milestone: variables });
      expect(matched.ok && matched.value.length, widget.id).toBeGreaterThan(0);
    }
  });
});

describe("dashboard save", () => {
  it("writes a new file in the format's key order and returns its commit", async () => {
    const value = saved(await save("release", SPEC));
    expect(value.path).toBe(`${DIR}/release.yaml`);
    expect(value.created).toBe(true);
    expect(await text("release")).toBe(
      [
        "title: Release",
        "widgets:",
        "  - id: results",
        "    title: Results",
        "    type: donut",
        "    group_by: last_result",
        "    width: 4",
        "  - id: p0",
        "    title: P0",
        "    type: stat",
        "    query: priority = P0",
        "",
      ].join("\n"),
    );
    expect(value.commit).toEqual({
      author: AGENT_AUTHOR,
      message: `test(web): add dashboard release\n\nRequested-by: qa@acme.example\nAgent: claude-code\nCasefile-Change: ${value.change}\nCasefile-Dashboard: release\n`,
      files: [value.path],
    });
    expect((await list()).map((d) => d.slug)).toContain("release");
  });

  it("replaces the file whole, as the human, without an author", async () => {
    const value = saved(await save("overview", SPEC, "human"));
    expect(value.created).toBe(false);
    expect(Dashboard.parse(parse(await text("overview")))).toEqual(Dashboard.parse(SPEC));
    expect(value.commit.author).toBeUndefined();
    expect(value.commit.message).toContain("test(web): update dashboard overview\n");
    expect(value.commit.message).not.toContain("Agent:");
  });

  it("refuses the same dashboard again and writes nothing", async () => {
    saved(await save("release", SPEC));
    expect(codes(await save("release", SPEC))).toEqual([["dashboard.no_change", "spec"]]);
  });

  it("names the field of a shape problem", async () => {
    const result = await save("release", {
      title: "Release",
      widgets: [{ id: "a", title: "A", type: "bar" }],
    });
    expect(codes(result)).toEqual([["operation.invalid_input", "spec.widgets.0.group_by"]]);
  });

  it("refuses duplicate ids, unknown milestones and bad queries, all at once", async () => {
    const before = await text("overview");
    const result = await save("overview", {
      title: "Release",
      widgets: [
        { id: "a", title: "A", type: "stat", query: "state = = active" },
        { id: "a", title: "B", type: "stat", milestone: "web-9.9.9" },
        { id: "c", title: "C", type: "stat", query: "milestone.name = x" },
        { id: "d", title: "D", type: "stat", query: "milestone.name = x", milestone: "web-1.2.0" },
      ],
    });
    expect(codes(result)).toEqual([
      ["dashboard.invalid_query", "spec.widgets.0.query"],
      ["dashboard.duplicate_widget", "spec.widgets.1.id"],
      ["dashboard.unknown_milestone", "spec.widgets.1.milestone"],
      ["dashboard.invalid_query", "spec.widgets.2.query"],
    ]);
    expect(await text("overview")).toBe(before);
  });

  it("needs an agent to name itself and refuses CI", async () => {
    const unnamed = await registry.invoke(
      "dashboard-save",
      { ...host, slug: "release", spec: SPEC },
      { root, actor: "agent" },
    );
    expect(codes(unnamed)).toEqual([["dashboard.agent_required", "agent"]]);
    const ci = await save("release", SPEC, "ci");
    expect(ci.ok).toBe(false);
  });
});

describe("dashboard list", () => {
  it("lists the demo's dashboards by slug with their widget counts", async () => {
    expect(await list()).toEqual([
      {
        project: "web",
        slug: "overview",
        title: "Overview",
        description: "Where the cases are and which ones still have no test.",
        widgets: DEMO_EXPECTED.dashboards.overview.length,
        path: `${DIR}/overview.yaml`,
      },
      {
        project: "web",
        slug: "web-1-2-0",
        title: "Web 1.2.0",
        description: null,
        widgets: DEMO_EXPECTED.dashboards["web-1-2-0"].length,
        path: `${DIR}/web-1-2-0.yaml`,
      },
    ]);
  });

  it("leaves out a file that does not load", async () => {
    await writeFile(join(root, DIR, "broken.yaml"), "title: Broken\nwidgets: []\n");
    expect((await list()).map((d) => d.slug)).toEqual(["overview", "web-1-2-0"]);
  });
});

describe("dashboard show", () => {
  const show = (slug: string) => registry.invoke("dashboard-show", { slug }, { root, actor: "ci" });

  it("returns every widget with its data, as the oracle says", async () => {
    const result = await show("overview");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const value = result.value as {
      title: string;
      path: string;
      date: string;
      widgets: { id: string; width: number; data?: { type: string; value?: number } }[];
    };
    expect(value).toMatchObject({ title: "Overview", path: `${DIR}/overview.yaml` });
    expect(value.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value.widgets.map((w) => w.id)).toEqual(DEMO_EXPECTED.dashboards.overview);
    expect(value.widgets[0]).toMatchObject({
      width: 3,
      data: { type: "stat", value: DEMO_EXPECTED.dashboardData.overview.total },
    });
    expect(value.widgets.every((w) => w.data !== undefined)).toBe(true);
  });

  it("shows a widget whose milestone is gone with its error, the others with data", async () => {
    await rm(join(root, "context/milestones/web-1.2.0.yaml"));
    const result = await show("web-1-2-0");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { widgets } = result.value as { widgets: { error?: { code: string } }[] };
    expect(widgets.map((w) => w.error?.code)).toEqual([
      "dashboard.unknown_milestone",
      "dashboard.unknown_milestone",
      "dashboard.unknown_milestone",
    ]);
  });

  it("does not know a dashboard that is not there", async () => {
    expect(codes(await show("nope"))).toEqual([["dashboard.unknown", "slug"]]);
  });
});

describe("dashboard remove", () => {
  it("deletes the file and returns the commit of the deletion", async () => {
    const result = await remove("overview");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const value = result.value as Saved;
    expect(value.commit.files).toEqual([`${DIR}/overview.yaml`]);
    expect(value.commit.message).toBe(
      `test(web): remove dashboard overview\n\nRequested-by: qa@acme.example\nAgent: claude-code\nCasefile-Change: ${value.change}\nCasefile-Dashboard: overview\n`,
    );
    expect((await list()).map((d) => d.slug)).toEqual(["web-1-2-0"]);
  });

  it("removes a file that does not load", async () => {
    await writeFile(join(root, DIR, "broken.yaml"), "title: Broken\nwidgets: []\n");
    expect((await remove("broken", "human")).ok).toBe(true);
    await expect(text("broken")).rejects.toThrow();
  });

  it("says which dashboards exist when the slug is unknown", async () => {
    const result = await remove("nope");
    expect(codes(result)).toEqual([["dashboard.unknown", "slug"]]);
    expect(!result.ok && result.errors[0]?.message).toContain("overview, web-1-2-0");
  });
});
