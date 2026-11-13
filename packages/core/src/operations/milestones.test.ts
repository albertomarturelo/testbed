import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEMO_MONOREPO_ROOT, DEMO_ROOT } from "../demo.fixture.js";
import { evaluateGates } from "../gates/evaluate.js";
import { AGENT_AUTHOR } from "../git/trailers.js";
import { loadWorkspace } from "../load/workspace.js";
import { resolveWorkspace } from "../resolve/resolve.js";
import { withMilestone } from "../schema/index.js";
import { milestoneOpenOperation } from "./milestone-open.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";
import { runOperation } from "./run.js";

const registry = createRegistry();
registry.register(milestoneOpenOperation);
registry.register(runOperation);

const MILESTONES = "apps/web/context/milestones";
const RUNS = "apps/web/context/tests/.runs";
const host = { identity: "qa@acme.example", project: "web", via: "cli:milestone-open" };

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-milestone-"));
  await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const open = (input: Record<string, unknown>, actor: Actor = "agent") =>
  registry.invoke(
    "milestone-open",
    { ...host, agent: "claude-code", ...input },
    {
      root,
      actor,
    },
  );
const record = (input: Record<string, unknown>) =>
  registry.invoke(
    "run",
    { identity: "qa@acme.example", project: "web", ref: "TC-0002", status: "passed", ...input },
    { root, actor: "human" },
  );
const declare = (slug: string, state: "open" | "closed") =>
  writeFile(join(root, MILESTONES, `${slug}.yaml`), `title: ${slug}\nstate: ${state}\n`);

describe("milestone open (ADR milestones-group-executions)", () => {
  it("writes the file open, with who opened it, and returns its commit", async () => {
    const result = await open({
      slug: "web-2.1.0",
      title: "Web 2.1.0",
      due: "2026-12-01",
      release: "web-2.1.0",
      scope: "priority IN (P0, P1) and state = active",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const value = result.value as {
      path: string;
      change: string;
      commit: { author?: string; message: string; files: string[] };
    };
    expect(value.path).toBe(`${MILESTONES}/web-2.1.0.yaml`);
    const file = parse(await readFile(join(root, value.path), "utf8"));
    expect(file).toEqual({
      title: "Web 2.1.0",
      state: "open",
      due: "2026-12-01",
      release: "web-2.1.0",
      scope: "priority IN (P0, P1) and state = active",
      opened: { at: expect.any(String), by: "qa@acme.example", change: value.change },
    });
    expect(value.commit).toEqual({
      author: AGENT_AUTHOR,
      message: `test(web): open milestone web-2.1.0\n\nRequested-by: qa@acme.example\nAgent: claude-code\nCasefile-Change: ${value.change}\n`,
      files: [value.path],
    });
  });

  it("refuses a slug the project has, and a scope that does not parse", async () => {
    expect((await open({ slug: "s", title: "S" })).ok).toBe(true);
    expect(await open({ slug: "s", title: "Again" })).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.exists", field: "slug" }],
    });
    expect(await open({ slug: "t", title: "T", scope: "priority =" })).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.invalid_scope", field: "scope" }],
    });
  });
});

describe("executions name an open milestone", () => {
  beforeEach(() => mkdir(join(root, MILESTONES), { recursive: true }));

  it("stores the milestone on the event", async () => {
    await declare("sprint-23", "open");
    const result = await record({ milestone: "sprint-23" });
    expect(result).toMatchObject({ ok: true, value: { event: { milestone: "sprint-23" } } });
  });

  it("refuses an unknown or closed milestone and writes nothing", async () => {
    await declare("old", "closed");
    await declare("sprint-23", "open");
    const runFile = join(root, RUNS, `manual-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const before = await readFile(runFile, "utf8").catch(() => "");
    expect(await record({ milestone: "sprint-2" })).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.unknown", field: "milestone" }],
    });
    expect(await record({ milestone: "old" })).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.closed", field: "milestone" }],
    });
    expect(await readFile(runFile, "utf8").catch(() => "")).toBe(before);
  });

  it("takes the old --release as the milestone, with a deprecation notice", async () => {
    await declare("sprint-23", "open");
    const result = await record({ release: "sprint-23" });
    expect(result).toMatchObject({ ok: true, value: { event: { milestone: "sprint-23" } } });
    const value = (result.ok ? result.value : {}) as { event: object; next: string[] };
    expect(value.event).not.toHaveProperty("release");
    expect(value.next.at(-1)).toContain("--release is deprecated");
    expect(await record({ milestone: "sprint-23", release: "sprint-23" })).toMatchObject({
      ok: false,
      errors: [{ code: "operation.invalid_input", field: "release" }],
    });
  });
});

describe("old run files: release read as milestone", () => {
  it("compares an old line and a new one as the same event", () => {
    const old = { case_id: "TC-0001", status: "passed", release: "web-1.2.0" };
    expect(withMilestone(old)).toEqual({
      case_id: "TC-0001",
      status: "passed",
      milestone: "web-1.2.0",
    });
    const current = { case_id: "TC-0001", milestone: "web-1.2.0" };
    expect(withMilestone(current)).toBe(current);
  });

  it("evaluates gates over old release events with milestone.* or release.* scopes", async () => {
    const workspace = await loadWorkspace(DEMO_ROOT);
    const project = workspace.projects[0];
    if (project === undefined) throw new Error("demo-repo lost its project");
    const { cases: resolved } = resolveWorkspace(workspace, { commitFor: () => null });
    const evaluate = (scope: string) =>
      evaluateGates({
        policy: { gates: [{ name: "g", scope, require: { executed: 0 } }] },
        policyPath: "context/releases/policy.yaml",
        cases: resolved,
        runs: project.runs,
        release: "web-1.2.0",
        today: "2026-10-20",
      });
    const viaMilestone = evaluate("milestone.name = web-1.2.0");
    const viaRelease = evaluate("release.name = web-1.2.0");
    expect(viaMilestone.ok && viaMilestone.value.gates[0]?.verdict).toBe("green");
    expect(viaRelease).toEqual(viaMilestone);
  });
});
