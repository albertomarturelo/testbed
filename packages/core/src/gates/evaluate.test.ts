import { describe, expect, it } from "vitest";
import { DEMO_EXPECTED, DEMO_ROOT } from "../demo.fixture.js";
import type { LoadedRun } from "../load/parse.js";
import { loadWorkspace } from "../load/workspace.js";
import { resolveWorkspace } from "../resolve/resolve.js";
import type { Gate, ReleasePolicy, RunEvent } from "../schema/index.js";
import { evaluateGates, type GateInput, type GateResult, releaseName } from "./evaluate.js";

const workspace = await loadWorkspace(DEMO_ROOT);
const [project] = workspace.projects;
const { cases } = resolveWorkspace(workspace, { commitFor: () => null });
const POLICY_PATH = "context/releases/policy.yaml";
const TODAY = "2026-10-17";

describe("evaluateGates on examples/demo-repo", () => {
  const evaluate = (today = TODAY) => {
    if (project?.policy == null) throw new Error("demo policy missing");
    const report = evaluateGates({
      policy: project.policy,
      policyPath: POLICY_PATH,
      cases,
      runs: project.runs,
      release: "release:web-1.2.0",
      today,
    });
    if (!report.ok) throw new Error(report.errors[0]?.message);
    return report.value;
  };

  it("gives the designed verdict per gate", () => {
    const report = evaluate();
    expect(report.release).toBe("web-1.2.0");
    expect(report.build).toBe("web-1.2.0+101");
    expect(Object.fromEntries(report.gates.map((g) => [g.name, g.verdict]))).toEqual(
      DEMO_EXPECTED.gates,
    );
  });

  it("explains the red smoke gate: TC-0007 failed in CI", () => {
    const smoke = evaluate().gates.find((g) => g.name === "smoke");
    expect(smoke?.cases).toEqual(["TC-0001", "TC-0007"]);
    expect(smoke?.reasons).toEqual([
      { requirement: "failures", message: "failures are not allowed", cases: ["TC-0007"] },
    ]);
  });

  it("turns auth red once the triage of TC-0002 expires", () => {
    const auth = evaluate("2026-11-02").gates.find((g) => g.name === "auth");
    expect(auth?.verdict).toBe("red");
    expect(auth?.reasons.map((r) => [r.requirement, r.cases])).toEqual([["failures", ["TC-0002"]]]);
  });
});

/** Synthetic results for TC-0001 and TC-0002 of the demo; `line` keeps load order. */
let line = 0;
function run(
  case_id: string,
  status: RunEvent["status"],
  extra: Partial<RunEvent> = {},
): LoadedRun {
  line += 1;
  return {
    path: "context/tests/.runs/r.jsonl",
    line,
    event: {
      run_id: "r",
      case_id,
      status,
      executor: "ci:github-actions",
      at: "2026-10-15T12:00:00Z",
      release: "web-1.2.0",
      build: "b1",
      ...extra,
    },
  };
}

const SCOPE = "id IN (TC-0001, TC-0002)";

function gate(
  require: Gate["require"],
  runs: LoadedRun[],
  more: Partial<GateInput> & { scope?: string } = {},
): GateResult {
  const policy: ReleasePolicy = { gates: [{ name: "g", scope: more.scope ?? SCOPE, require }] };
  const report = evaluateGates({
    policy,
    policyPath: POLICY_PATH,
    cases,
    runs,
    release: "web-1.2.0",
    today: TODAY,
    ...more,
  });
  if (!report.ok) throw new Error(report.errors[0]?.message);
  const [result] = report.value.gates;
  if (result === undefined) throw new Error("no gate result");
  return result;
}

const verdict = (...args: Parameters<typeof gate>) => gate(...args).verdict;
const offenders = (...args: Parameters<typeof gate>) =>
  gate(...args).reasons.flatMap((r) => r.cases);

describe("evaluateGates: release and latest result", () => {
  it("strips the release: prefix", () => {
    expect(releaseName("release:web-1.2.0")).toBe("web-1.2.0");
    expect(releaseName("web-1.2.0")).toBe("web-1.2.0");
  });

  it("ignores results of other releases", () => {
    const runs = [run("TC-0001", "passed"), run("TC-0002", "passed", { release: "web-1.1.0" })];
    expect(offenders({ executed: 100 }, runs)).toEqual(["TC-0002"]);
  });

  it("takes the latest result by instant, not by text or file order", () => {
    const runs = [
      run("TC-0001", "passed", { at: "2026-10-15T12:00:00+02:00" }),
      run("TC-0001", "failed", { at: "2026-10-15T11:00:00Z" }),
      run("TC-0002", "failed", { at: "2026-10-15T12:00:00Z" }),
      run("TC-0002", "passed", { at: "2026-10-15T12:00:00Z" }),
    ];
    // 11:00Z is after 10:00Z (12:00+02:00); on a tie the later-loaded event wins.
    expect(offenders({ failures: "none" }, runs)).toEqual(["TC-0001"]);
  });

  it("is red when the scope selects no cases", () => {
    const result = gate({ executed: 0 }, [], { scope: "state = nonexistent" });
    expect(result.verdict).toBe("red");
    expect(result.reasons).toEqual([
      { requirement: "scope", message: "scope selects no cases: state = nonexistent", cases: [] },
    ]);
  });

  it("is green with no requirements when the scope selects cases", () => {
    expect(verdict({}, [])).toBe("green");
  });
});

describe("evaluateGates: executed and passed", () => {
  it("never lets a later skipped or not_run result hide an execution", () => {
    const runs = [
      run("TC-0001", "passed", { at: "2026-10-15T10:00:00Z" }),
      run("TC-0001", "skipped", { at: "2026-10-15T11:00:00Z" }),
      run("TC-0002", "failed", { at: "2026-10-15T10:00:00Z" }),
      run("TC-0002", "not_run", { at: "2026-10-15T11:00:00Z" }),
    ];
    expect(verdict({ executed: 100 }, runs)).toBe("green");
    expect(offenders({ failures: "none" }, runs)).toEqual(["TC-0002"]);
  });

  it("counts passed, failed and blocked as executed, not skipped or not_run", () => {
    const executed = [run("TC-0001", "blocked"), run("TC-0002", "failed")];
    expect(verdict({ executed: 100 }, executed)).toBe("green");
    const skipped = [run("TC-0001", "passed"), run("TC-0002", "skipped")];
    expect(gate({ executed: 100 }, skipped).reasons).toEqual([
      {
        requirement: "executed",
        message: "50 % of 2 cases executed, 100 % required",
        cases: ["TC-0002"],
      },
    ]);
    expect(verdict({ executed: 50 }, skipped)).toBe("green");
    expect(offenders({ executed: 100 }, [run("TC-0001", "not_run")])).toEqual([
      "TC-0001",
      "TC-0002",
    ]);
  });

  it("requires the share of passed results", () => {
    const runs = [run("TC-0001", "passed"), run("TC-0002", "failed")];
    expect(verdict({ passed: 50 }, runs)).toBe("green");
    expect(gate({ passed: 51 }, runs).reasons).toEqual([
      {
        requirement: "passed",
        message: "50 % of 2 cases passed, 51 % required",
        cases: ["TC-0002"],
      },
    ]);
  });
});

describe("evaluateGates: failures", () => {
  it("none: any failed or blocked result is red", () => {
    expect(verdict({ failures: "none" }, [run("TC-0001", "passed")])).toBe("green");
    const runs = [run("TC-0001", "blocked"), run("TC-0002", "failed")];
    expect(offenders({ failures: "none" }, runs)).toEqual(["TC-0001", "TC-0002"]);
  });

  it("triaged: every failure needs a triage that has not expired", () => {
    const triage = { kind: "known_issue" as const, by: "lead@acme.example" };
    const runs = [
      run("TC-0001", "failed", { triage }),
      run("TC-0002", "blocked", { triage: { ...triage, expires: TODAY } }),
    ];
    expect(verdict({ failures: "triaged" }, runs)).toBe("green");
    expect(offenders({ failures: "triaged" }, runs, { today: "2026-10-18" })).toEqual(["TC-0002"]);
    expect(offenders({ failures: "triaged" }, [run("TC-0001", "failed")])).toEqual(["TC-0001"]);
  });
});

describe("evaluateGates: executor, build and source", () => {
  it("executor: every result comes from an accepted kind", () => {
    const runs = [
      run("TC-0001", "passed"),
      run("TC-0002", "passed", { executor: "human:qa@acme.example" }),
    ];
    expect(verdict({ executor: ["ci", "human"] }, runs)).toBe("green");
    expect(gate({ executor: ["ci"] }, runs).reasons).toEqual([
      {
        requirement: "executor",
        message: "results not from an accepted executor (ci)",
        cases: ["TC-0002"],
      },
    ]);
  });

  it("build current: results on the latest build of the release, or the caller's", () => {
    const runs = [
      run("TC-0001", "passed", { build: "b1", at: "2026-10-15T10:00:00Z" }),
      run("TC-0002", "passed", { build: "b2", at: "2026-10-15T11:00:00Z" }),
    ];
    expect(offenders({ build: "current" }, runs)).toEqual(["TC-0001"]);
    expect(offenders({ build: "current" }, runs, { build: "b1" })).toEqual(["TC-0002"]);
    expect(verdict({ build: "any" }, runs)).toBe("green");
  });

  it("build current: red when no run of the release names a build", () => {
    const result = gate({ build: "current" }, [run("TC-0001", "passed", { build: undefined })]);
    expect(result.reasons).toEqual([
      { requirement: "build", message: "no build known for the release", cases: [] },
    ]);
  });

  it("source: automated results carry automation_ref, manual ones do not", () => {
    const runs = [
      run("TC-0001", "passed", { automation_ref: "login.spec.ts" }),
      run("TC-0002", "passed"),
    ];
    expect(offenders({ source: "automated" }, runs)).toEqual(["TC-0002"]);
    expect(offenders({ source: "manual" }, runs)).toEqual(["TC-0001"]);
    expect(verdict({ source: "any" }, runs)).toBe("green");
  });

  it("collects one reason per failed requirement", () => {
    const runs = [run("TC-0001", "failed", { executor: "agent:claude-code" })];
    expect(
      gate({ executed: 100, failures: "none", executor: ["ci"] }, runs).reasons.map(
        (r) => r.requirement,
      ),
    ).toEqual(["executed", "failures", "executor"]);
  });
});

describe("evaluateGates: scope variables and errors", () => {
  it("binds release.name and release.build in scopes", () => {
    const runs = [run("TC-0001", "passed", { build: "b9" })];
    const scope =
      "work_items CONTAINS release:web-1.2.0 AND release.build = b9 AND release.name = web-1.2.0";
    expect(gate({}, runs, { scope }).cases).toEqual(["TC-0001", "TC-0003", "TC-0004"]);
  });

  it("fails the evaluation, located at the gate, when a scope does not parse", () => {
    const policy: ReleasePolicy = {
      gates: [
        { name: "ok", scope: SCOPE, require: {} },
        { name: "bad", scope: "state = (", require: {} },
      ],
    };
    const report = evaluateGates({
      policy,
      policyPath: POLICY_PATH,
      cases,
      runs: [],
      release: "x",
      today: TODAY,
    });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.errors[0]).toMatchObject({ path: POLICY_PATH, field: "gates.1.scope" });
    expect(report.errors[0]?.column).toBeTypeOf("number");
  });

  it("reports release.build as unknown when the release has no build", () => {
    const report = evaluateGates({
      policy: { gates: [{ name: "g", scope: "build = release.build", require: {} }] },
      policyPath: POLICY_PATH,
      cases,
      runs: [],
      release: "web-9.9.9",
      today: TODAY,
    });
    expect(report.ok ? [] : report.errors.map((e) => [e.code, e.field])).toEqual([
      ["query.unknown_variable", "gates.0.scope"],
    ]);
  });
});
