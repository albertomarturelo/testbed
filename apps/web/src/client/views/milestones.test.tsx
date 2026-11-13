// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EvidenceDocument, forgetSession, type MilestoneRow, type Result } from "@/api";
import { formatRoute, parseRoute } from "@/route";
import { EvidencePrint, MilestonePage } from "@/views/MilestonePage";
import { Milestones } from "@/views/Milestones";
import { RunRecorder } from "@/views/RunRecorder";

/** What the fake API answers, per operation; inputs are recorded in `calls`. */
let answers: Record<string, (input: Record<string, unknown>) => Result<unknown>> = {};
const calls: { name: string; input: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = { session: () => ({ ok: true, value: { token: "t", identity: null } }) };
  window.location.hash = "";
  forgetSession();
  vi.stubGlobal("fetch", async (url: string, init?: { body: string }) => {
    const name = url.split("/").at(-1) as string;
    const input = init === undefined ? {} : (JSON.parse(init.body) as Record<string, unknown>);
    if (init !== undefined) calls.push({ name, input });
    const answer = answers[name]?.(input) ?? { ok: false, errors: [{ code: "x", message: name }] };
    return new Response(JSON.stringify(answer));
  });
});
afterEach(() => {
  window.sessionStorage.clear();
  cleanup();
  vi.unstubAllGlobals();
});

const callsOf = (name: string) => calls.filter((c) => c.name === name).map((c) => c.input);
const commit = (subject: string) => ({
  message: `${subject}\n\nRequested-by: qa@acme.example\n`,
  files: ["x"],
  sha: "abcdef1234567",
});

const row = (over: Partial<MilestoneRow>): MilestoneRow => ({
  project: "web",
  slug: "web-1.2.0",
  title: "Web 1.2.0",
  state: "open",
  due: null,
  release: null,
  path: "context/milestones/web-1.2.0.yaml",
  closed: null,
  totals: { in_scope: 5, executed: 3, passed: 2, failed: 1, blocked: 0, not_run: 2 },
  red_gates: [],
  ...over,
});

const doc = (over: Partial<EvidenceDocument> = {}): EvidenceDocument => ({
  project: "web",
  slug: "web-1.2.0",
  title: "Web 1.2.0",
  release: "v1.2.0",
  due: "2026-11-30",
  scope: "state = active",
  build: "web-1.2.0+101",
  opened: { at: "2026-11-01T09:00:00Z", by: "qa@acme.example" },
  closed: null,
  totals: { in_scope: 2, executed: 1, passed: 0, failed: 1, blocked: 0, not_run: 1 },
  gates: [
    { name: "smoke", verdict: "red", cases: 2, reasons: "failures: not allowed (TC-0007)" },
    { name: "auth", verdict: "green", cases: 1, reasons: null },
  ],
  cases: [
    {
      id: "TC-0007",
      title: "Search the catalog",
      priority: "P1",
      result: "failed",
      executor: "human:qa@acme.example",
      at: "2026-11-02T10:00:00Z",
      build: "web-1.2.0+101",
      note: "no results",
      evidence: ["ci/search.log"],
    },
    {
      id: "TC-0003",
      title: "Pay with a saved card",
      priority: "P1",
      result: null,
      executor: null,
      at: null,
      build: null,
      note: null,
      evidence: [],
    },
  ],
  note: null,
  ...over,
});

describe("milestone routes", () => {
  it("round-trips the list, a milestone and its printable evidence", () => {
    const routes = [
      { view: "milestones", project: "web" },
      { view: "milestone", project: "web", slug: "web-1.2.0" },
      { view: "milestone", project: "web", slug: "web-1.2.0", evidence: true },
    ] as const;
    for (const route of routes) expect(parseRoute(formatRoute(route))).toEqual(route);
    expect(formatRoute(routes[2])).toBe("#/milestone/web/web-1.2.0/evidence");
    // Anything else under a milestone is the case list, like any unknown path.
    expect(parseRoute("#/milestone/web/web-1.2.0/other").view).toBe("cases");
    expect(parseRoute("#/milestone/web").view).toBe("cases");
  });
});

describe("Milestones", () => {
  it("lists open then closed milestones with their progress and red gates", async () => {
    answers["milestone-list"] = () => ({
      ok: true as const,
      value: {
        milestones: [
          row({ red_gates: ["smoke"], due: "2026-11-30", release: "v1.2.0" }),
          row({
            slug: "sprint-1",
            title: "Sprint 1",
            state: "closed",
            closed: { at: "2026-11-01T09:00:00Z", by: "lead@acme.example" },
            totals: { in_scope: 4, executed: 4, passed: 4, failed: 0, blocked: 0, not_run: 0 },
          }),
          row({ slug: "broken", title: "Broken", totals: null }),
        ],
      },
    });
    render(<Milestones project="web" projects={["web"]} />);
    const open = await screen.findByRole("rowheader", { name: /Open/ });
    expect(open.textContent).toBe("Open · 2");
    expect(screen.getByRole("rowheader", { name: /Closed/ }).textContent).toBe("Closed · 1");
    expect(screen.getByText("3 of 5 executed, 2 passed")).toBeTruthy();
    expect(screen.getByText("4 of 4 executed, 4 passed")).toBeTruthy();
    expect(screen.getByText("smoke")).toBeTruthy();
    expect(screen.getByText("closed 2026-11-01 09:00 UTC")).toBeTruthy();
    expect(screen.getByText("2026-11-30")).toBeTruthy();
    expect(screen.getByText(/cannot be read/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Web 1\.2\.0/ }).getAttribute("href")).toBe(
      "#/milestone/web/web-1.2.0",
    );
    expect(callsOf("milestone-list")).toEqual([{ project: "web" }]);
  });

  it("opens a milestone with only what was filled, and lists it again", async () => {
    const user = userEvent.setup();
    let listed: MilestoneRow[] = [];
    answers["milestone-list"] = () => ({ ok: true, value: { milestones: listed } });
    answers["milestone-open"] = (input) => {
      listed = [row({ slug: String(input.slug), title: String(input.title) })];
      return {
        ok: true as const,
        value: {
          project: "web",
          slug: input.slug,
          path: "x",
          change: "c",
          commit: commit("test(web): open milestone sprint-2"),
          next: [],
        },
      };
    };
    render(<Milestones projects={["web"]} />);
    expect(await screen.findByText(/No milestones yet/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open milestone" }));
    const form = screen.getByRole("form", { name: "Open a milestone" });
    // One project: nothing to choose.
    expect(within(form).queryByLabelText("Project")).toBeNull();
    await user.type(within(form).getByLabelText("Title"), " Sprint 2 ");
    await user.type(within(form).getByLabelText("Slug"), "sprint-2");
    await user.click(within(form).getByRole("button", { name: "Open" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "Opened sprint-2. Committed abcdef1: test(web): open milestone sprint-2",
    );
    expect(callsOf("milestone-open")).toEqual([
      { project: "web", title: "Sprint 2", slug: "sprint-2" },
    ]);
    expect(await screen.findByText("Sprint 2")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Open a milestone" })).toBeNull();
  });

  it("asks which project in a workspace of several, and shows an error under its field", async () => {
    const user = userEvent.setup();
    answers["milestone-list"] = () => ({ ok: true, value: { milestones: [] } });
    answers["milestone-open"] = () => ({
      ok: false as const,
      errors: [{ code: "milestone.exists", field: "slug", message: "web already has it" }],
    });
    render(<Milestones projects={["web", "api"]} />);
    await user.click(await screen.findByRole("button", { name: "Open milestone" }));
    const form = screen.getByRole("form", { name: "Open a milestone" });
    await user.selectOptions(within(form).getByLabelText("Project"), "api");
    await user.type(within(form).getByLabelText("Title"), "API 3");
    await user.type(within(form).getByLabelText("Slug"), "api-3");
    await user.type(within(form).getByLabelText("Scope"), "priority = P0");
    await user.click(within(form).getByRole("button", { name: "Open" }));
    expect(await within(form).findByText("web already has it")).toBeTruthy();
    expect(within(form).getByLabelText("Slug").getAttribute("aria-invalid")).toBe("true");
    expect(callsOf("milestone-open")).toEqual([
      { project: "api", title: "API 3", slug: "api-3", scope: "priority = P0" },
    ]);
  });
});

describe("MilestonePage", () => {
  const report = (over: Record<string, unknown> = {}) => ({
    ok: true as const,
    value: {
      project: "web",
      slug: "web-1.2.0",
      state: "open",
      path: "context/milestones/web-1.2.0/evidence.md",
      evidence: "# Milestone evidence: Web 1.2.0\n",
      report: doc(),
      red_gates: ["smoke"],
      next: [],
      ...over,
    },
  });

  it("shows the cases with their result here, what was not executed and the gates", async () => {
    answers["milestone-report"] = () => report();
    render(<MilestonePage project="web" slug="web-1.2.0" version={0} />);
    expect(await screen.findByRole("heading", { name: "Web 1.2.0" })).toBeTruthy();
    expect(screen.getByText("1 of 2 executed, 0 passed")).toBeTruthy();
    const cases = screen.getByRole("region", { name: "Cases" });
    expect(within(cases).getByRole("link", { name: "TC-0007" }).getAttribute("href")).toBe(
      "#/case/web/TC-0007",
    );
    expect(within(cases).getByText("failed")).toBeTruthy();
    expect(within(cases).getByText("not run")).toBeTruthy();
    // As the evidence file has it: UTC, whatever the reader's time zone.
    expect(within(cases).getByText("2026-11-02 10:00 UTC")).toBeTruthy();
    expect(within(cases).getByText("ci/search.log")).toBeTruthy();
    const missing = screen.getByRole("region", { name: "Not executed" });
    expect(missing.textContent).toContain("TC-0003 Pay with a saved card");
    const gates = screen.getByRole("region", { name: "Gates" });
    expect(within(gates).getByText("red")).toBeTruthy();
    expect(within(gates).getByText("failures: not allowed (TC-0007)")).toBeTruthy();
    expect(screen.getByText(/Open: generated from the run files now/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Printable evidence" }).getAttribute("href")).toBe(
      "#/milestone/web/web-1.2.0/evidence",
    );
    expect(callsOf("milestone-report")).toEqual([{ project: "web", slug: "web-1.2.0" }]);
  });

  it("asks why red gates are accepted before closing, then closes as the human", async () => {
    const user = userEvent.setup();
    let closed = false;
    answers["milestone-report"] = () =>
      closed
        ? report({
            state: "closed",
            red_gates: undefined,
            report: doc({
              closed: { at: "2026-11-13T10:00:00Z", by: "qa@acme.example" },
              note: "Known staging data issue",
            }),
          })
        : report();
    answers["milestone-close"] = () => {
      closed = true;
      return {
        ok: true as const,
        value: {
          project: "web",
          slug: "web-1.2.0",
          evidence: "context/milestones/web-1.2.0/evidence.md",
          path: "context/milestones/web-1.2.0.yaml",
          change: "c",
          red_gates: ["smoke"],
          commit: commit("test(web): close milestone web-1.2.0"),
          next: [],
        },
      };
    };
    const onWritten = vi.fn();
    render(<MilestonePage project="web" slug="web-1.2.0" version={0} onWritten={onWritten} />);
    await user.click(await screen.findByRole("button", { name: "Close milestone" }));
    const form = screen.getByRole("form", { name: "Close the milestone" });
    expect(within(form).getByText("Red now: smoke. The note goes into the evidence.")).toBeTruthy();
    await user.click(within(form).getByRole("button", { name: "Close and freeze the evidence" }));
    // Said here, before core would refuse it: nothing is sent.
    expect(within(form).getByText("Gates are red: say why they are accepted.")).toBeTruthy();
    expect(callsOf("milestone-close")).toEqual([]);

    await user.type(
      within(form).getByLabelText("Why are the red gates accepted?"),
      "Known staging data issue",
    );
    await user.click(within(form).getByRole("button", { name: "Close and freeze the evidence" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Closed web-1.2.0: its evidence is frozen in");
    expect(status.textContent).toContain("Committed abcdef1: test(web): close milestone web-1.2.0");
    expect(callsOf("milestone-close")).toEqual([
      { project: "web", slug: "web-1.2.0", note: "Known staging data issue" },
    ]);
    expect(onWritten).toHaveBeenCalledOnce();
    // Read again: closed, with its note, and no Close button any more.
    expect(await screen.findByText(/Closed: the frozen evidence in/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Close note" }).textContent).toContain(
      "Known staging data issue",
    );
    expect(screen.queryByRole("button", { name: "Close milestone" })).toBeNull();
  });

  it("shows a frozen file core can no longer read as it is", async () => {
    answers["milestone-report"] = () =>
      report({
        state: "closed",
        report: undefined,
        red_gates: undefined,
        evidence: "edited by hand",
      });
    render(<MilestonePage project="web" slug="web-1.2.0" version={0} />);
    expect(await screen.findByText("edited by hand")).toBeTruthy();
    expect(screen.getByText("ui.evidence_unreadable", { exact: false })).toBeTruthy();
  });

  it("shows why a milestone cannot be read", async () => {
    answers["milestone-report"] = () => ({
      ok: false as const,
      errors: [{ code: "milestone.unknown", message: "web has no milestone 'nope'" }],
    });
    render(<MilestonePage project="web" slug="nope" version={0} />);
    expect(await screen.findByText("web has no milestone 'nope'")).toBeTruthy();
  });
});

describe("EvidencePrint", () => {
  it("lays out the document without forms or case links, and prints on request", async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal("print", print);
    answers["milestone-report"] = () => ({
      ok: true as const,
      value: {
        project: "web",
        slug: "web-1.2.0",
        state: "closed",
        path: "p",
        evidence: "",
        report: doc({ closed: { at: "2026-11-13T10:00:00Z", by: "lead@acme.example" } }),
        next: [],
      },
    });
    render(<EvidencePrint project="web" slug="web-1.2.0" version={0} />);
    expect(await screen.findByRole("heading", { name: "Web 1.2.0" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "TC-0007" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
    expect(document.title).toBe("Milestone evidence web web-1.2.0");
    // On paper the cases and what was not executed start a page.
    expect(screen.getByRole("region", { name: "Cases" }).className).toContain(
      "print:break-before-page",
    );
    await user.click(screen.getByRole("button", { name: "Print or save as PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });
});

describe("RunRecorder milestone picker (#166)", () => {
  const opened = () => ({
    ok: true as const,
    value: {
      milestones: [
        row({ slug: "web-1.2.0", title: "Web 1.2.0" }),
        row({ slug: "sprint-1", title: "sprint-1" }),
      ],
    },
  });
  const recordedRun = {
    ok: true as const,
    value: {
      ref: "web/TC-0001",
      run: "manual-2026-11-13",
      path: "p",
      appended: true,
      event: { status: "passed" },
      next: [],
    },
  };

  it("offers the project's open milestones or none, and sends the chosen one", async () => {
    const user = userEvent.setup();
    answers["milestone-list"] = opened;
    answers.run = () => recordedRun;
    const onRecorded = vi.fn();
    render(<RunRecorder caseRef="web/TC-0001" onRecorded={onRecorded} onCancel={() => {}} />);
    const picker = screen.getByLabelText("Milestone") as HTMLSelectElement;
    await vi.waitFor(() => expect(picker.options).toHaveLength(3));
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      "None",
      "Web 1.2.0 (web-1.2.0)",
      "sprint-1",
    ]);
    expect(picker.value).toBe("");
    expect(callsOf("milestone-list")).toEqual([{ open: true, project: "web" }]);
    await user.selectOptions(screen.getByLabelText("Result"), "passed");
    await user.selectOptions(picker, "sprint-1");
    await user.click(screen.getByRole("button", { name: "Record" }));
    await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(callsOf("run")).toEqual([
      { ref: "web/TC-0001", status: "passed", milestone: "sprint-1" },
    ]);
  });

  it("starts with the milestone the case was opened from", async () => {
    answers["milestone-list"] = opened;
    render(
      <RunRecorder
        caseRef="web/TC-0001"
        milestone="web-1.2.0"
        onRecorded={() => {}}
        onCancel={() => {}}
      />,
    );
    const picker = screen.getByLabelText("Milestone") as HTMLSelectElement;
    expect(picker.value).toBe("web-1.2.0");
    await vi.waitFor(() => expect(picker.options).toHaveLength(3));
    expect(picker.value).toBe("web-1.2.0");
  });

  it("says when the project has no open milestone", async () => {
    answers["milestone-list"] = () => ({ ok: true, value: { milestones: [] } });
    render(<RunRecorder caseRef="web/TC-0001" onRecorded={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText("No open milestone in this project.")).toBeTruthy();
  });
});

describe("milestone commits name the ticket the repository asks for", () => {
  beforeEach(() => {
    answers.session = () => ({
      ok: true as const,
      value: { token: "t", identity: null, commit: { ticket: true, branchTicket: "ACME-7" } },
    });
  });

  it("sends the ticket when opening a milestone", async () => {
    const user = userEvent.setup();
    answers["milestone-list"] = () => ({ ok: true as const, value: { milestones: [] } });
    answers["milestone-open"] = () => ({
      ok: false as const,
      errors: [{ code: "commit.ticket_invalid", field: "ticket", message: "not a ticket" }],
    });
    render(<Milestones project="web" projects={["web"]} />);
    await user.click(await screen.findByRole("button", { name: "Open milestone" }));
    const form = screen.getByRole("form", { name: "Open a milestone" });
    // Starts as the branch names it.
    expect(((await within(form).findByLabelText("Ticket")) as HTMLInputElement).value).toBe(
      "ACME-7",
    );
    await user.type(within(form).getByLabelText("Title"), "Sprint 2");
    await user.type(within(form).getByLabelText("Slug"), "sprint-2");
    await user.click(within(form).getByRole("button", { name: "Open" }));
    // A ticket error shows under the ticket.
    expect(await within(form).findByText("not a ticket")).toBeTruthy();
    expect(callsOf("milestone-open")).toEqual([
      { project: "web", title: "Sprint 2", slug: "sprint-2", ticket: "ACME-7" },
    ]);
  });

  it("sends the ticket when closing a milestone", async () => {
    const user = userEvent.setup();
    answers["milestone-report"] = () => ({
      ok: true as const,
      value: {
        project: "web",
        slug: "web-1.2.0",
        state: "open",
        path: "p",
        evidence: "",
        report: doc({ gates: null }),
        red_gates: [],
        next: [],
      },
    });
    answers["milestone-close"] = () => ({
      ok: false as const,
      errors: [{ code: "x", message: "stop here" }],
    });
    render(<MilestonePage project="web" slug="web-1.2.0" version={0} />);
    await user.click(await screen.findByRole("button", { name: "Close milestone" }));
    const form = screen.getByRole("form", { name: "Close the milestone" });
    const ticket = (await within(form).findByLabelText("Ticket")) as HTMLInputElement;
    await user.clear(ticket);
    await user.type(ticket, "ACME-9");
    await user.click(within(form).getByRole("button", { name: "Close and freeze the evidence" }));
    expect(await within(form).findByText("stop here")).toBeTruthy();
    // No red gate: no note needed, none sent.
    expect(callsOf("milestone-close")).toEqual([
      { project: "web", slug: "web-1.2.0", ticket: "ACME-9" },
    ]);
  });
});
