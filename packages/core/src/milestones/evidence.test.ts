import { describe, expect, it } from "vitest";
import { DEMO_ROOT } from "../demo.fixture.js";
import type { LoadedRun } from "../load/parse.js";
import { loadWorkspace } from "../load/workspace.js";
import { resolveWorkspace } from "../resolve/resolve.js";
import type { Milestone, RunEvent } from "../schema/index.js";
import {
  EVIDENCE_NOTE_MAX,
  type EvidenceInput,
  evidenceDocument,
  milestoneEvidence,
  parseEvidence,
  redGates,
  renderEvidence,
} from "./evidence.js";

const workspace = await loadWorkspace(DEMO_ROOT);
const [project] = workspace.projects;
if (project === undefined || project.policy === null) throw new Error("demo project missing");
const demo = project;
const { cases } = resolveWorkspace(workspace, { commitFor: () => null });
const declared = demo.milestones.get("web-1.2.0");
if (declared === undefined) throw new Error("demo milestone missing");

/** The demo's milestone, closed on a date its triage still holds. */
const input = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  project: "web",
  slug: "web-1.2.0",
  milestone: declared.file,
  milestonePath: declared.path,
  cases,
  runs: demo.runs,
  policy: {
    policy: demo.policy as NonNullable<typeof demo.policy>,
    path: "context/releases/policy.yaml",
  },
  closed: { at: "2026-10-20T16:00:00Z", by: "lead@acme.example" },
  note: "Search (TC-0007) fails on staging data only; ACME-412 tracks it.",
  today: "2026-10-20",
  ...over,
});

const evidence = (over: Partial<EvidenceInput> = {}) => {
  const result = milestoneEvidence(input(over));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
};

const event = (over: Partial<RunEvent>): LoadedRun => ({
  path: "context/tests/.runs/extra.jsonl",
  line: 1,
  event: {
    run_id: "extra",
    case_id: "TC-0001",
    status: "passed",
    executor: "human:qa@acme.example",
    at: "2026-10-18T09:00:00Z",
    milestone: "sprint-1",
    ...over,
  },
});
const sprint: Milestone = { title: "Sprint 1 regression", state: "open" };

describe("milestone evidence (ADR milestones-group-executions §4)", () => {
  it("renders the demo milestone as the golden evidence file", async () => {
    const value = evidence();
    expect(value.totals).toEqual({
      in_scope: 5,
      executed: 5,
      passed: 3,
      failed: 2,
      blocked: 0,
      not_run: 0,
    });
    expect(redGates(value)).toEqual(["smoke"]);
    await expect(renderEvidence(value)).toMatchFileSnapshot("./demo-web-1.2.0.evidence.md");
  });

  it("is deterministic for the same files and date", () => {
    expect(renderEvidence(evidence())).toBe(renderEvidence(evidence()));
  });

  it("turns a gate red when the evaluation date passes a triage", () => {
    expect(redGates(evidence({ today: "2026-11-13" }))).toEqual(["smoke", "auth"]);
  });

  it("has no gates section without a release policy", () => {
    const value = evidence({ policy: null });
    expect(value.gates).toBeNull();
    expect(redGates(value)).toEqual([]);
    expect(renderEvidence(value)).not.toContain("## Gates");
  });

  it("lists the cases never executed; skipped and other milestones' results do not count", () => {
    const value = evidence({
      slug: "sprint-1",
      milestone: sprint,
      policy: null,
      note: undefined,
      runs: [
        ...demo.runs, // all of milestone web-1.2.0
        event({ case_id: "TC-0001", status: "blocked", note: "staging down" }),
        event({ case_id: "TC-0003", status: "skipped" }),
      ],
    });
    expect(value.totals).toEqual({
      in_scope: 5,
      executed: 1,
      passed: 0,
      failed: 0,
      blocked: 1,
      not_run: 4,
    });
    expect(value.cases.find((c) => c.id === "TC-0003")?.result).toBeNull();
    const text = renderEvidence(value);
    expect(text).toContain("## Not executed\n\n- TC-0002 ");
    expect(text).toContain("- TC-0003 Pay with a saved card\n");
    expect(text).not.toContain("## Close note");
  });

  it("keeps each row on one line: pipes escaped, long notes cut", () => {
    const long = `line one | part\nline two ${"x".repeat(EVIDENCE_NOTE_MAX)}`;
    const value = evidence({
      slug: "sprint-1",
      milestone: sprint,
      policy: null,
      runs: [event({ status: "failed", note: long, evidence: [{ kind: "log", ref: "a|b.log" }] })],
    });
    const note = value.cases[0]?.note ?? "";
    expect(note.startsWith("line one | part line two x")).toBe(true);
    expect(note).toHaveLength(EVIDENCE_NOTE_MAX);
    const row = renderEvidence(value)
      .split("\n")
      .find((line) => line.startsWith("| TC-0001 "));
    expect(row).toContain("line one \\| part line two");
    expect(row).toContain("| a\\|b.log |");
  });

  it("reports a milestone scope that does not parse at the milestone file", () => {
    const result = milestoneEvidence(input({ milestone: { ...sprint, scope: "priority =" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ path: declared.path, field: "scope" });
  });

  it("says a report is not frozen evidence", () => {
    expect(renderEvidence(evidence({ closed: null, note: undefined }))).toContain(
      "| Closed | not closed: a report, not frozen evidence |",
    );
  });
});

describe("frozen evidence read back (#166: the viewer shows and prints the file)", () => {
  it("reads the golden file as the document it was rendered from", async () => {
    const { readFile } = await import("node:fs/promises");
    const golden = await readFile(new URL("./demo-web-1.2.0.evidence.md", import.meta.url), "utf8");
    const document = parseEvidence(golden);
    expect(document).toEqual(evidenceDocument(evidence()));
    expect(document?.gates?.[0]).toEqual({
      name: "smoke",
      verdict: "red",
      cases: 2,
      reasons: "failures: failures are not allowed (TC-0007)",
    });
    expect(document?.cases[2]?.evidence).toEqual(["ci/artifacts/search.log"]);
  });

  it("round-trips escaped pipes, cases not run, no policy and a report's open stamp", () => {
    const value = evidence({
      slug: "sprint-1",
      milestone: { ...sprint, due: "2026-11-30" },
      policy: null,
      closed: null,
      note: "two\nlines | kept",
      runs: [
        event({
          status: "failed",
          note: "a | b \\ c",
          evidence: [
            { kind: "log", ref: "a|b.log" },
            { kind: "log", ref: "c.log" },
          ],
        }),
      ],
    });
    const document = parseEvidence(renderEvidence(value));
    expect(document).toEqual(evidenceDocument(value));
    expect(document?.gates).toBeNull();
    expect(document?.closed).toBeNull();
    expect(document?.cases[0]).toMatchObject({
      note: "a | b \\ c",
      evidence: ["a|b.log", "c.log"],
    });
    expect(document?.cases[1]?.result).toBeNull();
  });

  it("reads an empty gate list and an empty scope", () => {
    const value = evidence({
      milestone: { ...sprint, scope: "priority = P9" },
      slug: "sprint-1",
      policy: { policy: { gates: [] }, path: "context/releases/policy.yaml" },
    });
    expect(parseEvidence(renderEvidence(value))).toEqual(evidenceDocument(value));
  });

  it("gives null for text of another shape", () => {
    expect(parseEvidence("# Something else\n")).toBeNull();
    expect(parseEvidence("# Milestone evidence: X\n\nno table\n")).toBeNull();
  });
});
