import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_EXPECTED, DEMO_MONOREPO_ROOT, DEMO_ROOT } from "../demo.fixture.js";
import { gatesOperation } from "./gates.js";
import { createRegistry } from "./registry.js";

const registry = createRegistry();
registry.register(gatesOperation);

const gates = (input: Record<string, unknown>, root = DEMO_ROOT) =>
  registry.invoke("gates", input, { root, actor: "ci" });

type Gates = {
  milestone: string;
  state: string;
  date: string;
  build: string | null;
  green: boolean;
  gates: {
    name: string;
    verdict: string;
    cases: string[];
    reasons: { requirement: string; cases: string[] }[];
  }[];
  next: string[];
};
const value = async (input: Record<string, unknown>, root = DEMO_ROOT) => {
  const result = await gates(input, root);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value as Gates;
};
const verdicts = (v: Gates) => Object.fromEntries(v.gates.map((g) => [g.name, g.verdict]));
const codes = (result: { ok: boolean; errors?: { code: string }[] }) =>
  result.ok ? [] : (result.errors ?? []).map((e) => e.code);

let scratch = "";
afterEach(() => (scratch === "" ? undefined : rm(scratch, { recursive: true, force: true })));
const copyOf = async (root: string) => {
  scratch = await mkdtemp(join(tmpdir(), "casefile-gates-"));
  await cp(root, scratch, { recursive: true });
  return scratch;
};

describe("gates (ADR release-gate-evaluation, milestones-group-executions)", () => {
  it("gives the demo's verdicts on a date its triage still holds", async () => {
    const v = await value({ milestone: "web-1.2.0", date: "2026-10-20" });
    expect(verdicts(v)).toEqual(DEMO_EXPECTED.gates);
    expect(v).toMatchObject({
      milestone: "web-1.2.0",
      state: "open",
      date: "2026-10-20",
      build: "web-1.2.0+101",
      green: false,
      next: [],
    });
    const smoke = v.gates.find((g) => g.name === "smoke");
    expect(smoke?.cases).toEqual(DEMO_EXPECTED.queries["labels.smoke = true AND state = active"]);
    expect(smoke?.reasons).toEqual([
      { requirement: "failures", message: "failures are not allowed", cases: ["TC-0007"] },
    ]);
  });

  it("accepts the old release ref, and turns auth red once the triage expired", async () => {
    const v = await value({ milestone: "release:web-1.2.0", date: "2026-11-02" });
    expect(v.milestone).toBe("web-1.2.0");
    expect(verdicts(v)).toEqual({ ...DEMO_EXPECTED.gates, auth: "red" });
  });

  it("evaluates today (UTC) by default", async () => {
    const v = await value({ milestone: "web-1.2.0" });
    expect(v.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("takes the caller's build for build: current", async () => {
    const v = await value({ milestone: "web-1.2.0", date: "2026-10-20", build: "web-1.2.0+102" });
    expect(v.build).toBe("web-1.2.0+102");
    expect(verdicts(v)["payments-regression"]).toBe("red");
  });

  it("refuses a ref that names nothing, and a malformed date", async () => {
    expect(codes(await gates({ milestone: "release:" }))).toEqual(["gates.invalid_milestone"]);
    expect(codes(await gates({ milestone: "web-1.2.0", date: "20/10/2026" }))).toEqual([
      "operation.invalid_input",
    ]);
  });

  it("evaluates an undeclared milestone, and says when nothing names it", async () => {
    const v = await value({ milestone: "web-9.9.9", date: "2026-10-20" });
    expect(v.state).toBe("undeclared");
    expect(v.green).toBe(false);
    expect(v.next[0]).toContain("No execution names 'web-9.9.9' yet");
    expect(v.next[1]).toContain("casefile milestone open web-9.9.9");
  });

  it("says a closed milestone's record is its frozen evidence", async () => {
    const root = await copyOf(DEMO_ROOT);
    await writeFile(
      join(root, "context/milestones/web-1.2.0.yaml"),
      "title: Web 1.2.0\nstate: closed\nrelease: web-1.2.0\n",
    );
    const v = await value({ milestone: "web-1.2.0", date: "2026-10-20" }, root);
    expect(v.state).toBe("closed");
    expect(v.next).toEqual([expect.stringContaining("context/milestones/web-1.2.0/evidence.md")]);
  });

  it("locates a gate scope that does not parse", async () => {
    const root = await copyOf(DEMO_ROOT);
    await writeFile(
      join(root, "context/releases/policy.yaml"),
      "gates:\n  - name: typo\n    scope: priority =\n    require: { executed: 100 }\n",
    );
    const result = await gates({ milestone: "web-1.2.0" }, root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      path: "context/releases/policy.yaml",
      field: "gates.0.scope",
    });
  });

  it("returns the policy's own errors when it does not match its schema", async () => {
    const root = await copyOf(DEMO_ROOT);
    await writeFile(join(root, "context/releases/policy.yaml"), "gates: nope\n");
    const result = await gates({ milestone: "web-1.2.0" }, root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.every((e) => e.path === "context/releases/policy.yaml")).toBe(true);
  });

  it("needs the project in a workspace of several, and a policy in it", async () => {
    expect(codes(await gates({ milestone: "web-1.2.0" }, DEMO_MONOREPO_ROOT))).toEqual([
      "project.required",
    ]);
    const result = await gates({ milestone: "web-1.2.0", project: "web" }, DEMO_MONOREPO_ROOT);
    expect(codes(result)).toEqual(["gates.no_policy"]);
    if (!result.ok) expect(result.errors[0]?.path).toBe("apps/web/context/releases/policy.yaml");
  });

  it("evaluates only the selected project's cases and runs", async () => {
    const root = await copyOf(DEMO_MONOREPO_ROOT);
    // A gate over every case: web's own two, never api's TC-0001.
    await mkdir(join(root, "apps/web/context/releases"));
    await writeFile(
      join(root, "apps/web/context/releases/policy.yaml"),
      "gates:\n  - name: all\n    scope: state != retired\n    require: { executed: 0 }\n",
    );
    const v = await value({ milestone: "web-1.2.0", project: "web" }, root);
    expect(v.gates[0]?.cases).toEqual(["TC-0001", "TC-0002"]);
  });
});
