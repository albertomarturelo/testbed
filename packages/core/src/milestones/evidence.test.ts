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

describe("attempts and requirements (#208)", () => {
  const sprintEvidence = (runs: LoadedRun[], over: Partial<EvidenceInput> = {}) =>
    evidence({ slug: "sprint-1", milestone: sprint, policy: null, closed: null, runs, ...over });
  /** The demo's cases with other `acceptance_ref`s, by id. */
  const linked = (refs: Record<string, string[] | undefined>) =>
    cases.map((c) => (c.id in refs ? { ...c, acceptance_ref: refs[c.id] } : c));

  it("counts every execution of a case in the milestone, and its failures", () => {
    const value = sprintEvidence([
      event({ status: "failed", at: "2026-10-18T09:00:00Z" }),
      event({ status: "passed", at: "2026-10-18T10:00:00Z" }),
      // Not executions, and another milestone's: none counts.
      event({ status: "skipped", at: "2026-10-18T11:00:00Z" }),
      event({ status: "failed", at: "2026-10-18T12:00:00Z", milestone: "sprint-2" }),
    ]);
    const tc1 = value.cases.find((c) => c.id === "TC-0001");
    expect(tc1).toMatchObject({ result: "passed", attempts: { total: 2, failed: 1 } });
    expect(value.cases.find((c) => c.id === "TC-0002")?.attempts).toEqual({ total: 0, failed: 0 });
    const markdown = renderEvidence(value);
    expect(markdown).toContain(
      "| TC-0001 | Sign in with valid credentials | P0 | passed | 2 (1 failed) |",
    );
    expect(parseEvidence(markdown)).toEqual(evidenceDocument(value));
  });

  it("gives each requirement its cases and one verdict: failed, blocked, not run, passed", () => {
    const value = sprintEvidence(
      [
        event({ case_id: "TC-0001", status: "passed" }),
        event({ case_id: "TC-0002", status: "failed" }),
        event({ case_id: "TC-0003", status: "passed" }),
        event({ case_id: "TC-0004", status: "blocked" }),
        event({ case_id: "TC-0007", status: "failed" }),
      ],
      {
        cases: linked({
          // TC-0003 passed and TC-0004 blocked share one requirement: blocked.
          "TC-0004": ["ACME-202#AC-1"],
          // A failure wins over a pass for the same requirement.
          "TC-0007": ["ACME-101#AC-1", "ACME-101#AC-1"],
        }),
      },
    );
    expect(value.requirements).toEqual([
      { ref: "ACME-101#AC-1", cases: ["TC-0001", "TC-0007"], verdict: "failed" },
      { ref: "ACME-101#AC-3", cases: ["TC-0002"], verdict: "failed" },
      { ref: "ACME-202#AC-1", cases: ["TC-0003", "TC-0004"], verdict: "blocked" },
    ]);
    expect(value.unlinked).toEqual([]);
    const markdown = renderEvidence(value);
    expect(markdown).toContain("| ACME-202#AC-1 | TC-0003, TC-0004 | blocked |");
    expect(markdown).toContain("Every case in scope names a requirement.");
    expect(parseEvidence(markdown)).toEqual(evidenceDocument(value));
  });

  it("says not run while a requirement's case has no result, and lists cases with none", () => {
    const value = sprintEvidence([event({ case_id: "TC-0001", status: "passed" })], {
      cases: linked({ "TC-0003": undefined, "TC-0004": undefined }),
    });
    expect(value.requirements.map((r) => [r.ref, r.verdict])).toEqual([
      ["ACME-101#AC-1", "passed"],
      ["ACME-101#AC-3", "not run"],
    ]);
    // In case order; TC-0007 names none in the demo.
    expect(value.unlinked).toEqual(["TC-0007", "TC-0003", "TC-0004"]);
    const markdown = renderEvidence(value);
    expect(markdown).toContain("Cases that name no requirement: TC-0007, TC-0003, TC-0004.");
    expect(parseEvidence(markdown)).toEqual(evidenceDocument(value));
  });

  it("says so when no case in scope names a requirement", () => {
    const value = sprintEvidence([], {
      cases: cases.map((c) => ({ ...c, acceptance_ref: undefined })),
    });
    const markdown = renderEvidence(value);
    expect(markdown).toContain("No case in scope names a requirement (`acceptance_ref`).");
    expect(markdown).not.toContain("Every case in scope names a requirement.");
    expect(parseEvidence(markdown)).toEqual(evidenceDocument(value));
  });
});

describe("edits after the open (#213)", () => {
  const opened = { at: "2026-10-10T09:00:00Z", by: "qa@acme.example", change: "c-open" };
  const edited: Milestone["edited"] = [
    { at: "2026-10-12T14:30:00Z", by: "qa@acme.example", change: "c-1", fields: ["due", "scope"] },
    { at: "2026-10-15T08:05:00Z", by: "lead@acme.example", change: "c-2", fields: ["title"] },
  ];

  it("lists each edit after Opened, oldest first, and reads them back", async () => {
    const value = evidence({ milestone: { ...declared.file, opened, edited } });
    expect(value.edited).toEqual([
      { at: "2026-10-12T14:30:00Z", by: "qa@acme.example", fields: ["due", "scope"] },
      { at: "2026-10-15T08:05:00Z", by: "lead@acme.example", fields: ["title"] },
    ]);
    const markdown = renderEvidence(value);
    expect(markdown).toContain(
      [
        "| Opened | 2026-10-10T09:00:00Z by qa@acme.example |",
        "| Edited | 2026-10-12T14:30:00Z by qa@acme.example: due, scope |",
        "| Edited | 2026-10-15T08:05:00Z by lead@acme.example: title |",
        "| Closed | 2026-10-20T16:00:00Z by lead@acme.example |",
      ].join("\n"),
    );
    await expect(markdown).toMatchFileSnapshot("./demo-web-1.2.0.edited.evidence.md");
    expect(parseEvidence(markdown)).toEqual(evidenceDocument(value));
  });

  it("adds no row for a milestone never edited, and reads none back", () => {
    const value = evidence({ milestone: { ...declared.file, opened } });
    expect(value.edited).toEqual([]);
    const markdown = renderEvidence(value);
    expect(markdown).not.toContain("| Edited |");
    expect(parseEvidence(markdown)?.edited).toEqual([]);
  });

  it("gives null for an Edited row it did not write", () => {
    const markdown = renderEvidence(evidence({ milestone: { ...declared.file, opened, edited } }));
    expect(
      parseEvidence(markdown.replace("by lead@acme.example: title", "lead@acme.example")),
    ).toBeNull();
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

  it("reads evidence frozen before #208: no attempts, no requirements", async () => {
    const { readFile } = await import("node:fs/promises");
    const old = await readFile(
      new URL("./demo-web-1.2.0.pre-208.evidence.md", import.meta.url),
      "utf8",
    );
    const document = parseEvidence(old);
    const current = evidenceDocument(evidence());
    expect(document).toEqual({
      ...current,
      cases: current.cases.map((c) => ({ ...c, attempts: null })),
      requirements: null,
      unlinked: null,
    });
  });

  it("gives null for text of another shape", () => {
    expect(parseEvidence("# Something else\n")).toBeNull();
    expect(parseEvidence("# Milestone evidence: X\n\nno table\n")).toBeNull();
  });
});
