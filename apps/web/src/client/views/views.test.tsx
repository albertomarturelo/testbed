// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, RUN_COLUMNS_KEY } from "@/App";
import { type CaseRow, forgetSession, type Result } from "@/api";
import { FeatureTree, featureOpenKey, tally, tallyLine } from "@/components/FeatureTree";
import { CaseDetail } from "@/views/CaseDetail";
import { CaseList } from "@/views/CaseList";
import { NewCase } from "@/views/NewCase";
import { QueryView } from "@/views/QueryView";
import { ValidateView } from "@/views/ValidateView";

/** What the fake API answers, per operation; inputs are recorded in `calls`. */
let answers: Record<string, (input: Record<string, unknown>) => Result<unknown>> = {};
const calls: { name: string; input: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = {};
  window.location.hash = "";
  forgetSession();
  vi.stubGlobal("fetch", async (url: string, init?: { body: string }) => {
    const name = url.split("/").at(-1) as string;
    if (init === undefined) {
      // GET /api/session: answered like an operation, with no input.
      const answer = answers[name]?.({}) ?? { ok: false, errors: [{ code: "x", message: name }] };
      return new Response(JSON.stringify(answer));
    }
    const input = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ name, input });
    const answer = answers[name]?.(input) ?? { ok: false, errors: [{ code: "x", message: name }] };
    return new Response(JSON.stringify(answer));
  });
});
afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.unstubAllGlobals();
});

describe("CaseList", () => {
  const row = (id: string, title: string, automation: Partial<CaseRow>): CaseRow => ({
    ref: `web/${id}`,
    project: "web",
    feature: "login",
    title,
    state: "draft",
    priority: "P2",
    automation: "manual",
    automation_ref: null,
    eligible: true,
    last_run: null,
    last_run_at: null,
    ...automation,
  });
  const rows = [
    row("TC-0001", "Proven", {
      automation: "automated",
      automation_ref: "login.spec.ts::proven",
      last_run: "failed",
      last_run_at: "2026-10-17T19:23:06Z",
    }),
    row("TC-0002", "Linked", { automation_ref: "login.spec.ts::linked" }),
    row("TC-0003", "Linked, in progress", {
      automation: "in_progress",
      automation_ref: "login.spec.ts::wip",
    }),
    // A human run proves nothing: the case is still only linked.
    row("TC-0006", "Linked, run by hand", {
      automation_ref: "login.spec.ts::by hand",
      last_run: "passed",
      last_run_at: "2026-10-16T10:00:00Z",
    }),
    row("TC-0004", "By hand", {}),
    row("TC-0005", "Needs an account", { eligible: false }),
  ];
  const automationCell = (title: string) =>
    screen.getByRole("link", { name: title }).closest("tr")?.querySelectorAll("td")[4]?.textContent;

  it("tells a linked case that never ran from manual and from not eligible", () => {
    render(<CaseList rows={rows} />);
    expect(automationCell("Proven")).toBe("automated");
    expect(automationCell("Linked")).toBe("linked");
    expect(automationCell("Linked, in progress")).toBe("linked");
    expect(automationCell("Linked, run by hand")).toBe("linked");
    expect(automationCell("By hand")).toBe("no test");
    expect(automationCell("Needs an account")).toBe("not eligible");
    // The badge says which test is linked and what the case still resolves to.
    expect(
      screen.getAllByTitle(/^Linked to login\.spec\.ts::wip; .*\(in progress\)$/),
    ).toHaveLength(1);
  });

  it("tells an eligible case without a test from one nobody can automate (#111)", () => {
    render(<CaseList rows={rows} />);
    const noTest = screen.getByText("no test");
    expect(noTest.getAttribute("title")).toBe(
      "Can be automated: no test is linked to it yet (manual)",
    );
    const notEligible = screen.getByText("not eligible");
    expect(notEligible.getAttribute("title")).toBe(
      "automation.eligible is false: nobody can automate it",
    );
    // `manual` no longer appears for an eligible case: it read as "tested by hand".
    expect(screen.queryByText("manual")).toBeNull();
    // A candidate without a test keeps its own word.
    cleanup();
    render(<CaseList rows={[row("TC-0009", "Planned", { automation: "candidate" })]} />);
    expect(automationCell("Planned")).toBe("candidate");
  });

  it("draws automated lighter than a run result", () => {
    render(<CaseList rows={rows} />);
    const tr = screen.getByRole("link", { name: "Proven" }).closest("tr");
    const automated = tr?.querySelectorAll("td")[4]?.querySelector('[data-slot="badge"]');
    const run = tr?.querySelectorAll("td")[5]?.querySelector('[data-slot="badge"]');
    expect(automated?.getAttribute("data-variant")).toBe("secondary");
    expect(run?.getAttribute("data-variant")).toBe("destructive");
    expect(automated?.querySelector("svg")).not.toBeNull();
  });

  it("keeps case, title, automation and last run when the list is narrow", () => {
    render(<CaseList rows={rows} />);
    const table = screen.getByRole("table");
    // Columns hide by the list's own width (a container query), not the viewport's.
    expect(table.closest(".\\@container")).not.toBeNull();
    const heads = screen.getAllByRole("columnheader");
    const hidden = heads.filter((h) => h.classList.contains("hidden")).map((h) => h.textContent);
    expect(hidden).toEqual(["State", "Priority"]);
    for (const h of heads.filter((h) => hidden.includes(h.textContent))) {
      expect(h.classList.contains("@4xl:table-cell")).toBe(true);
    }
    // Every cell of a hidden column hides with it.
    for (const tr of table.querySelectorAll("tbody tr")) {
      const cells = [...tr.querySelectorAll("td")].map((td) => td.classList.contains("hidden"));
      expect(cells).toEqual([false, false, true, true, false, false]);
    }
    // The title gives way instead of pushing Last run out: it wraps to two lines, then clamps.
    const title = screen.getByRole("link", { name: "Needs an account" });
    expect(title.classList.contains("line-clamp-2")).toBe(true);
    expect(title.classList.contains("truncate")).toBe(false);
    expect(title.getAttribute("title")).toBe("Needs an account");
    const cell = title.closest("td");
    expect(cell?.classList.contains("max-w-0")).toBe(true);
    // The table cell's default `whitespace-nowrap` would keep it on one line.
    expect(cell?.classList.contains("whitespace-normal")).toBe(true);
    // One project: the id is enough, the ref stays on hover.
    expect(screen.getByRole("link", { name: "TC-0005" }).getAttribute("title")).toBe("web/TC-0005");
  });

  it("has no Feature column: a leaf would repeat it in every row (#112)", () => {
    render(<CaseList rows={rows} />);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Case", "Title", "State", "Priority", "Automation", "Last run"]);
    for (const tr of screen.getByRole("table").querySelectorAll("tbody tr")) {
      expect(tr.querySelectorAll("td")).toHaveLength(6);
    }
  });

  it("keeps the full ref when the list mixes projects", () => {
    const api = { ...row("TC-0001", "Create an order", {}), ref: "api/TC-0001", project: "api" };
    render(<CaseList rows={[...rows, api]} />);
    expect(screen.getByRole("link", { name: "web/TC-0001" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "api/TC-0001" })).toBeTruthy();
  });
});

describe("CaseList grouped by feature (#112)", () => {
  const at = (id: string, feature: string): CaseRow => ({
    ref: `web/${id}`,
    project: "web",
    feature,
    title: `${feature} ${id}`,
    state: "active",
    priority: "P2",
    automation: "manual",
    automation_ref: null,
    eligible: true,
    last_run: null,
    last_run_at: null,
  });
  // Overview order (by id), features mixed; `auth-admin` sorts before `auth/login`
  // as a string, but after it in the tree, where `auth` and its children come first.
  const rows = [
    at("TC-0001", "checkout/payments"),
    at("TC-0002", "auth-admin"),
    at("TC-0003", "auth/login"),
    at("TC-0004", "auth"),
    at("TC-0005", "checkout/payments"),
    at("TC-0006", "billing"),
  ];
  const headings = () =>
    [...document.querySelectorAll('th[scope="rowgroup"]')].map((th) => th.textContent);

  it("lists one heading per feature, in tree order, with each group's count", () => {
    render(<CaseList rows={rows} grouped project="web" />);
    expect(headings()).toEqual([
      "auth · 1",
      "auth/login · 1",
      "auth-admin · 1",
      "billing · 1",
      "checkout/payments · 2",
    ]);
  });

  it("puts each case under its feature, keeping their order within it", () => {
    render(<CaseList rows={rows} grouped project="web" />);
    const group = screen.getByRole("link", { name: "checkout/payments" }).closest("tbody");
    const titles = [...(group?.querySelectorAll("td:nth-child(2)") ?? [])].map(
      (td) => td.textContent,
    );
    expect(titles).toEqual(["checkout/payments TC-0001", "checkout/payments TC-0005"]);
  });

  it("links each heading to its feature, as the tree does, and drops the Feature column", () => {
    render(<CaseList rows={rows} grouped project="web" />);
    expect(screen.getByRole("link", { name: "auth/login" }).getAttribute("href")).toBe(
      "#/cases?project=web&feature=auth%2Flogin",
    );
    expect(screen.queryByRole("columnheader", { name: "Feature" })).toBeNull();
    // The heading spans every column the table shows.
    const th = document.querySelector('th[scope="rowgroup"]');
    expect(th?.getAttribute("colSpan")).toBe("6");
  });

  it("spans only the columns left when automation and runs are hidden", () => {
    render(<CaseList rows={rows} grouped showAutomation={false} showLastRun={false} />);
    expect(document.querySelector('th[scope="rowgroup"]')?.getAttribute("colSpan")).toBe("4");
  });
});

describe("FeatureTree: parents fold and unfold (#114)", () => {
  const leaf = (ref: string, feature: string): CaseRow => ({
    ref,
    project: "web",
    feature,
    title: ref,
    state: "active",
    priority: "P2",
    automation: "manual",
    automation_ref: null,
    eligible: true,
    last_run: null,
    last_run_at: null,
  });
  const rows = [
    leaf("web/TC-0001", "auth"),
    leaf("web/TC-0002", "auth/login"),
    leaf("web/TC-0003", "auth/login/errors"),
    leaf("web/TC-0004", "billing"),
  ];
  const toggle = (path: string) => screen.getByRole("button", { name: `Features under ${path}` });
  // A tree link's name is the feature, its count, then its tally line (#87): match the start.
  const link = (start: string) => ({ name: (name: string) => name.startsWith(`${start} `) });
  const shown = (start: string) => screen.queryByRole("link", link(start)) !== null;

  it("shows each feature's cases by state and how many are linked, subtree included (#87)", () => {
    const states = [
      { ...leaf("web/TC-0005", "auth/login"), state: "draft" },
      { ...leaf("web/TC-0006", "auth/login"), state: "in_review", automation_ref: "x.spec.ts::y" },
      { ...leaf("web/TC-0007", "billing"), state: "retired" },
    ];
    render(<FeatureTree project="web" rows={[...rows, ...states]} />);
    const line = (start: string) =>
      screen.getByRole("link", link(start)).lastElementChild?.textContent;
    expect(line("auth 5")).toBe("1 draft · 1 in review · 3 active · 1 linked");
    expect(line("login 4")).toBe("1 draft · 1 in review · 2 active · 1 linked");
    expect(line("billing 2")).toBe("1 active · 1 retired · 0 linked");
    expect(screen.getByRole("link", { name: /^All features/ }).lastElementChild?.textContent).toBe(
      "1 draft · 1 in review · 4 active · 1 retired · 1 linked",
    );
  });

  it("orders states as a case moves through them, unknown ones last", () => {
    expect(tallyLine({ states: { zeta: 1, retired: 1, draft: 2, alpha: 1 }, linked: 3 })).toBe(
      "2 draft · 1 retired · 1 alpha · 1 zeta · 3 linked",
    );
    expect(tallyLine(tally([]))).toBe("0 linked");
  });

  it("gives every parent a chevron button apart from its link, open by default", () => {
    render(<FeatureTree project="web" rows={rows} selected="billing" />);
    expect(toggle("auth").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("auth/login").getAttribute("aria-expanded")).toBe("true");
    // A leaf has no chevron, and the button is not inside the link.
    expect(screen.queryByRole("button", { name: "Features under billing" })).toBeNull();
    expect(toggle("auth").closest("a")).toBeNull();
    expect(screen.getByRole("link", link("auth 3")).getAttribute("href")).toBe(
      "#/cases?project=web&feature=auth",
    );
    expect(shown("errors 1")).toBe(true);
  });

  it("hides the children on collapse, shows them on expand, and remembers it", () => {
    render(<FeatureTree project="web" rows={rows} selected="billing" />);
    fireEvent.click(toggle("auth"));
    expect(toggle("auth").getAttribute("aria-expanded")).toBe("false");
    expect(shown("login 2")).toBe(false);
    expect(shown("errors 1")).toBe(false);
    expect(shown("auth 3")).toBe(true);
    expect(window.location.hash).toBe("");
    expect(window.localStorage.getItem(featureOpenKey("web", "auth"))).toBe("0");

    cleanup();
    render(<FeatureTree project="web" rows={rows} selected="billing" />);
    expect(shown("login 2")).toBe(false);
    fireEvent.click(toggle("auth"));
    expect(shown("login 2")).toBe(true);
    expect(window.localStorage.getItem(featureOpenKey("web", "auth"))).toBe("1");
  });

  it("keeps the selected feature's ancestors open, even when the viewer folded them", () => {
    window.localStorage.setItem(featureOpenKey("web", "auth"), "0");
    window.localStorage.setItem(featureOpenKey("web", "auth/login"), "0");
    window.localStorage.setItem(featureOpenKey("web", "authz"), "0");
    const withAuthz = [...rows, leaf("web/TC-0005", "authz/roles")];
    render(<FeatureTree project="web" rows={withAuthz} selected="auth/login/errors" />);
    expect(shown("errors 1")).toBe(true);
    expect(toggle("auth").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("auth").getAttribute("aria-disabled")).toBe("true");
    // A sibling that only shares the name's prefix is not an ancestor.
    expect(toggle("authz").getAttribute("aria-expanded")).toBe("false");
    expect(toggle("authz").getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(toggle("auth"));
    expect(shown("errors 1")).toBe(true);
    // The selected feature itself is not its own ancestor: it folds as usual.
    cleanup();
    render(<FeatureTree project="web" rows={rows} selected="auth/login" />);
    expect(toggle("auth/login").getAttribute("aria-expanded")).toBe("false");
    expect(shown("errors 1")).toBe(false);
  });

  it("toggles from the keyboard with Enter and Space", async () => {
    const user = userEvent.setup();
    render(<FeatureTree project="web" rows={rows} selected="billing" />);
    toggle("auth").focus();
    await user.keyboard("{Enter}");
    expect(toggle("auth").getAttribute("aria-expanded")).toBe("false");
    expect(shown("login 2")).toBe(false);
    await user.keyboard(" ");
    expect(toggle("auth").getAttribute("aria-expanded")).toBe("true");
    expect(shown("login 2")).toBe(true);
  });

  it("starts every parent open and still folds when storage is unavailable", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    const storage = { getItem: vi.fn(blocked), setItem: vi.fn(blocked), clear: () => undefined };
    vi.stubGlobal("localStorage", storage);
    render(<FeatureTree project="web" rows={rows} selected="billing" />);
    expect(shown("errors 1")).toBe(true);
    fireEvent.click(toggle("auth"));
    expect(shown("login 2")).toBe(false);
    expect(storage.getItem).toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalled();
  });
});

describe("CaseDetail", () => {
  /** The page's headings and card titles (shadcn's are `div`s), in document order. */
  const outline = () =>
    [...document.querySelectorAll('h1, h2, [data-slot="card-title"]')].map((h) => h.textContent);

  it("shows the resolved case, its steps and where each value comes from", async () => {
    answers.resolve = () => ({
      ok: true,
      value: {
        ref: "web/TC-0001",
        path: "apps/web/context/tests/login/TC-0001.md",
        inherited: [
          { field: "priority", value: "P2", origin: "apps/web/context/tests/_common.yaml" },
        ],
        case: {
          title: "Sign in",
          state: "active",
          priority: "P2",
          automation: { status: "automated", eligible: true, ref: "login.spec.ts::signs in" },
          steps: [{ do: "Submit the form", expect: "The home page opens" }],
          history: [{ event: "created", at: "2026-10-05T09:00:00Z", by: "qa@acme.example" }],
        },
      },
    });
    answers.runs = () => ({ ok: true, value: { ref: "web/TC-0001", runs: [] } });
    // The list's choice to hide automation and runs never reaches the case page (#110).
    window.localStorage.setItem(RUN_COLUMNS_KEY, "0");
    render(<CaseDetail caseRef="web/TC-0001" />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("apps/web/context/tests/_common.yaml")).toBeTruthy();
    expect(screen.getByText("Submit the form")).toBeTruthy();
    expect(screen.getByText("login.spec.ts::signs in")).toBeTruthy();
    expect(await screen.findByText("Never ran.")).toBeTruthy();
    expect(calls).toEqual([
      { name: "resolve", input: { ref: "web/TC-0001" } },
      { name: "runs", input: { ref: "web/TC-0001" } },
    ]);
  });

  it("lists the case's runs newest first, with why a run failed and its evidence", async () => {
    answers.resolve = () => ({
      ok: true,
      value: {
        ref: "web/TC-0002",
        path: "context/tests/login/TC-0002.md",
        inherited: [],
        case: {
          title: "Empty submit",
          state: "draft",
          priority: "P2",
          automation: { status: "automated", eligible: true },
        },
      },
    });
    const path = "context/tests/.runs/9137.jsonl";
    answers.runs = () => ({
      ok: true,
      value: {
        ref: "web/TC-0002",
        runs: [
          {
            run_id: "9137",
            case_id: "TC-0002",
            status: "failed",
            executor: "ci:github-actions",
            at: "2026-10-17T19:23:06Z",
            duration_ms: 30018,
            build: "web-2.1.0+9",
            evidence: [{ kind: "attachment", ref: "test-results/x/error-context.md" }],
            note: "Test timeout of 30000ms exceeded.",
            path,
          },
          {
            run_id: "9100",
            case_id: "TC-0002",
            status: "passed",
            executor: "human:qa",
            at: "2026-10-10T08:00:00Z",
            path,
          },
        ],
      },
    });
    render(<CaseDetail caseRef="web/TC-0002" />);
    expect(await screen.findByText("Test timeout of 30000ms exceeded.")).toBeTruthy();
    // The note scrolls in a labelled region the keyboard can reach.
    const note = screen.getByRole("region", { name: "Note of the failed run 9137" });
    expect(note.getAttribute("tabindex")).toBe("0");
    expect(screen.getByText("test-results/x/error-context.md")).toBeTruthy();
    expect(screen.getByText("ci:github-actions")).toBeTruthy();
    expect(screen.getByText("30.0 s")).toBeTruthy();
    expect(screen.getByText("web-2.1.0+9")).toBeTruthy();
    const times = screen.getAllByRole("time").map((t) => t.getAttribute("datetime"));
    expect(times).toEqual(["2026-10-17T19:23:06Z", "2026-10-10T08:00:00Z"]);
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("passed")).toBeTruthy();
  });

  it("reads as a document: body, preconditions, data, numbered steps, references (#86)", async () => {
    answers.resolve = () => ({
      ok: true,
      value: {
        ref: "web/TC-0007",
        path: "context/tests/login/TC-0007.md",
        body: "Needs real credentials: manual.\n\nNo automated test may sign in.\n",
        inherited: [{ field: "priority", value: "P1", origin: "(the case)" }],
        case: {
          title: "Sign in with a registered account",
          state: "draft",
          priority: "P1",
          automation: { status: "manual", eligible: false },
          preconditions: ["A registered npm test account"],
          data: { base_url: "https://staging.acme.example", retries: 2 },
          steps: [
            { do: "Open the sign-in page", expect: "The form is empty" },
            { do: "Sign in", expect: "The account page opens" },
          ],
          // Listed twice on purpose: no duplicate React keys.
          acceptance_ref: [
            "ACME-101#AC-1",
            "https://tracker.example/ACME-101#ac-2",
            "ACME-101#AC-1",
          ],
          work_items: [
            "story:ACME-101",
            "issue:https://github.com/acme/web/issues/7",
            "x:javascript:alert(1)",
          ],
          history: [{ event: "created", at: "2026-10-17T19:22:51Z", by: "qa@acme.example" }],
        },
      },
    });
    answers.runs = () => ({ ok: true, value: { ref: "web/TC-0007", runs: [] } });
    render(<CaseDetail caseRef="web/TC-0007" />);
    await screen.findByRole("heading", { name: "Sign in with a registered account" });

    // The body as written, its blank line kept.
    const body = screen.getByText(/Needs real credentials/);
    expect(body.textContent).toBe(
      "Needs real credentials: manual.\n\nNo automated test may sign in.",
    );
    expect(body.className).toContain("whitespace-pre-wrap");

    // The title comes before where the case stands.
    const title = screen.getByRole("heading", { name: "Sign in with a registered account" });
    expect(title.nextElementSibling?.textContent).toContain("web/TC-0007");

    // Reading order: the document first, inherited values last.
    expect(outline()).toEqual([
      "Sign in with a registered account",
      "Preconditions",
      "Data",
      "Steps",
      "References",
      "History",
      "Runs",
      "Inherited values",
    ]);
    const order = (a: HTMLElement, b: HTMLElement) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(order(body, screen.getByRole("heading", { name: "Preconditions" }))).toBeTruthy();

    expect(screen.getByText("A registered npm test account")).toBeTruthy();
    expect(screen.getByText("base_url").nextElementSibling?.textContent).toBe(
      "https://staging.acme.example",
    );
    expect(screen.getByText("retries").nextElementSibling?.textContent).toBe("2");

    // Steps are numbered, each with its expected result.
    const rows = [...document.querySelectorAll("section tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ["1", "Open the sign-in page", "The form is empty"],
      ["2", "Sign in", "The account page opens"],
    ]);
    expect(screen.getByRole("columnheader", { name: "Expected result" })).toBeTruthy();

    // References: links only for http(s) URLs, whole or after a work item's kind.
    expect(screen.getAllByText("ACME-101#AC-1").every((el) => el.closest("a") === null)).toBe(true);
    const ac = screen.getByRole("link", { name: "https://tracker.example/ACME-101#ac-2" });
    expect(ac.getAttribute("href")).toBe("https://tracker.example/ACME-101#ac-2");
    expect(ac.getAttribute("rel")).toBe("noreferrer");
    expect(screen.getByText("story:ACME-101").closest("a")).toBeNull();
    const issue = screen.getByRole("link", { name: "https://github.com/acme/web/issues/7" });
    expect(issue.getAttribute("href")).toBe("https://github.com/acme/web/issues/7");
    expect(issue.parentElement?.textContent).toBe("issue:https://github.com/acme/web/issues/7");
    expect(screen.getByText("x:javascript:alert(1)").closest("a")).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("leaves out what a case does not have", async () => {
    answers.resolve = () => ({
      ok: true,
      value: {
        ref: "web/TC-0005",
        path: "context/tests/login/TC-0005.md",
        inherited: [],
        case: {
          title: "Bare",
          state: "draft",
          priority: "P3",
          automation: { status: "manual", eligible: true },
        },
      },
    });
    answers.runs = () => ({ ok: true, value: { ref: "web/TC-0005", runs: [] } });
    render(<CaseDetail caseRef="web/TC-0005" />);
    await screen.findByRole("heading", { name: "Bare" });
    expect(outline()).toEqual(["Bare", "Steps", "Runs", "Inherited values"]);
    expect(screen.getByText("No steps.")).toBeTruthy();
  });

  it("shows the errors of a case that does not resolve", async () => {
    answers.resolve = () => ({
      ok: false,
      errors: [{ code: "case.unknown", field: "ref", message: "no case TC-0009 in the workspace" }],
    });
    render(<CaseDetail caseRef="web/TC-0009" />);
    expect(await screen.findByText("no case TC-0009 in the workspace")).toBeTruthy();
    expect(calls.map((c) => c.name)).toEqual(["resolve"]);
  });
});

describe("CaseDetail: edit, approve and retire (#92)", () => {
  const created = {
    event: "created",
    at: "2026-10-05T09:00:00Z",
    by: "qa@acme.example",
    via: "cli:cover",
    change: "c-1",
    commit: "1111111aaaaaaa",
  };
  /** A resolved case in `state`; `after` history entries are appended once `review` succeeded. */
  const resolvedCase = (state: string, after: Record<string, unknown>[] = []) => ({
    ok: true as const,
    value: {
      ref: "web/TC-0001",
      path: "apps/web/context/tests/login/TC-0001.md",
      inherited: [],
      case: {
        id: "TC-0001",
        title: "Sign in",
        state,
        priority: "P2",
        labels: { risk: "auth", tags: ["smoke", "web"] },
        preconditions: ["An account exists"],
        automation: { status: "manual", eligible: true },
        steps: [
          { do: "Open the login page", expect: "The form shows" },
          { do: "Submit valid credentials", expect: "The home page opens", evidence: "screenshot" },
        ],
        history: [created, ...after],
      },
    },
  });
  const reviewed = (subject: string, state: string) => ({
    ok: true as const,
    value: {
      ref: "web/TC-0001",
      path: "apps/web/context/tests/login/TC-0001.md",
      change: "c-2",
      state,
      changed: [],
      events: [],
      commit: { message: `${subject}\n\nCasefile-Change: c-2`, files: [], sha: "2222222bbbbbbb" },
      next: [],
    },
  });
  const reviews = () => calls.filter((c) => c.name === "review").map((c) => c.input);

  beforeEach(() => {
    answers.runs = () => ({ ok: true, value: { ref: "web/TC-0001", runs: [] } });
  });

  it("saves only the changed fields in one review call, then shows the new entry and its commit", async () => {
    const user = userEvent.setup();
    let done = false;
    answers.resolve = () =>
      resolvedCase(
        "active",
        // Core does not derive commits yet (#51): the page names the one it just made.
        done ? [{ event: "updated", by: "qa@acme.example", change: "c-2", commit: null }] : [],
      );
    answers.review = () => {
      done = true;
      return reviewed("review(login): edit TC-0001", "active");
    };
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Sign in with a password");
    await user.selectOptions(screen.getByLabelText("Priority"), "P1");
    await user.click(screen.getByRole("button", { name: "Move step 2 up" }));
    await user.type(screen.getByLabelText("Step 1 expected result"), " at once");
    await user.click(screen.getByRole("button", { name: "Add precondition" }));
    await user.type(screen.getByLabelText("Precondition 2"), "The site is up");
    await user.clear(screen.getByLabelText("Label 2 value"));
    await user.type(screen.getByLabelText("Label 2 value"), "smoke");
    await user.click(screen.getByLabelText("Can be automated"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/review\(login\): edit TC-0001/)).toBeTruthy();
    expect(reviews()).toEqual([
      {
        ref: "web/TC-0001",
        base: "c-1",
        set: {
          title: "Sign in with a password",
          priority: "P1",
          preconditions: ["An account exists", "The site is up"],
          // Moved up and edited; the step keeps its evidence.
          steps: [
            {
              do: "Submit valid credentials",
              expect: "The home page opens at once",
              evidence: "screenshot",
            },
            { do: "Open the login page", expect: "The form shows" },
          ],
          // A list label stays a list; the untouched one is sent as it was, labels is one field.
          labels: { risk: "auth", tags: ["smoke"] },
          automation: { eligible: false },
        },
      },
    ]);
    // The page read the case again: the form is gone and the new entry shows its commit.
    expect(calls.map((c) => c.name).filter((n) => n === "resolve")).toHaveLength(2);
    expect(screen.queryByRole("form", { name: "Edit case" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("2222222");
    expect(screen.getByText("updated")).toBeTruthy();
    expect(screen.getAllByText("2222222").length).toBe(2);
  });

  it("edits only the case's own preconditions and labels, never what commons give it", async () => {
    const user = userEvent.setup();
    const common = "apps/web/context/tests/_common.yaml";
    answers.resolve = () => {
      const answer = resolvedCase("active");
      // `resolve` prepends commons preconditions and merges commons labels per key.
      Object.assign(answer.value.case, {
        preconditions: ["The site is up", "An account exists"],
        labels: { team: "web", risk: "auth", tags: ["smoke", "web"] },
      });
      answer.value.inherited = [
        { field: "preconditions.0", value: "The site is up", origin: common },
        { field: "preconditions.1", value: "An account exists", origin: "(the case)" },
        { field: "labels.team", value: "web", origin: common },
        { field: "labels.risk", value: "auth", origin: "(the case)" },
        { field: "labels.tags", value: '["smoke","web"]', origin: "(the case)" },
      ] as never[];
      return answer;
    };
    answers.review = () => reviewed("review(login): edit TC-0001", "active");
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    const shown = screen.getByRole("list", { name: "Inherited preconditions" }).textContent;
    expect(shown).toContain("The site is up");
    expect(shown).toContain(`from ${common}`);
    expect(screen.getByRole("list", { name: "Inherited labels" }).textContent).toContain(
      "team: web",
    );
    expect((screen.getByLabelText("Precondition 1") as HTMLInputElement).value).toBe(
      "An account exists",
    );
    expect(screen.queryByLabelText("Precondition 2")).toBeNull();
    expect(screen.queryByLabelText("Label 3 key")).toBeNull();

    await user.type(screen.getByLabelText("Precondition 1"), " and is active");
    await user.click(screen.getByRole("button", { name: "Remove label 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/edit TC-0001/);
    expect(reviews()[0]?.set).toEqual({
      preconditions: ["An account exists and is active"],
      labels: { tags: ["smoke", "web"] },
    });
  });

  it("calls nothing when no field changed", async () => {
    const user = userEvent.setup();
    answers.resolve = () => resolvedCase("active");
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status").textContent).toBe("Nothing changed.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(reviews()).toEqual([]);
  });

  it("puts a field's error under the field and any other error whole above the form", async () => {
    const user = userEvent.setup();
    answers.resolve = () => resolvedCase("active");
    answers.review = () => ({
      ok: false,
      errors: [
        { code: "operation.invalid_input", field: "set.steps.0.expect", message: "Too small" },
        {
          code: "label.undeclared",
          field: "set.labels.team",
          message: "label 'team' is not declared",
        },
        { code: "ui.commit_failed", message: "git commit failed: nothing staged" },
      ],
    });
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Step 1 expected result"));
    await user.click(screen.getByRole("button", { name: "Add label" }));
    await user.type(screen.getByLabelText("Label 3 key"), "team");
    await user.type(screen.getByLabelText("Label 3 value"), "web");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const step = (await screen.findByText("Too small")).closest("li");
    expect(step?.textContent).toContain("Step 1");
    expect(step?.textContent).toContain("operation.invalid_input");
    expect(screen.getByLabelText("Step 1 expected result").getAttribute("aria-invalid")).toBe(
      "true",
    );
    const label = screen.getByText("label 'team' is not declared").closest("li");
    expect(label?.querySelector("input")?.value).toBe("team");
    const whole = screen.getByText("git commit failed: nothing staged").closest('[role="alert"]');
    expect(whole?.textContent).toContain("ui.commit_failed");
    // The form stays open with what the QA typed.
    expect(screen.getByRole("form", { name: "Edit case" })).toBeTruthy();
    expect(reviews()[0]?.set).toMatchObject({ labels: { team: "web" } });
  });

  it("approves a draft after a confirmation, with one review call", async () => {
    const user = userEvent.setup();
    let state = "draft";
    answers.resolve = () => resolvedCase(state);
    answers.review = () => {
      state = "active";
      return reviewed("review(login): approve TC-0001", "active");
    };
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(screen.queryByRole("button", { name: "Retire" })).toBeNull();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("It moves from draft to active.");
    expect(reviews()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/approve TC-0001/)).toBeTruthy();
    expect(reviews()).toEqual([{ ref: "web/TC-0001", to: "active", base: "c-1" }]);
    // Now active: the page offers Retire, and never automated or flaky.
    expect(await screen.findByRole("button", { name: "Retire" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /automated|flaky/i })).toBeNull();
  });

  it("retires an active case after a confirmation; Cancel calls nothing", async () => {
    const user = userEvent.setup();
    answers.resolve = () => resolvedCase("active");
    answers.review = () => reviewed("review(login): retire TC-0001", "retired");
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Retire" }));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(reviews()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Retire" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Retire" }),
    );
    expect(await screen.findByText(/retire TC-0001/)).toBeTruthy();
    expect(reviews()).toEqual([{ ref: "web/TC-0001", to: "retired", base: "c-1" }]);
  });

  it("shows a refused write whole", async () => {
    const user = userEvent.setup();
    answers.resolve = () => resolvedCase("draft");
    answers.review = () => ({
      ok: false,
      errors: [{ code: "ui.forbidden", message: "a write needs the page's session token" }],
    });
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve" }),
    );
    const alert = (await screen.findByText("a write needs the page's session token")).closest(
      '[role="alert"]',
    );
    expect(alert?.textContent).toContain("ui.forbidden");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("CaseDetail: record a result (#93)", () => {
  const path = "apps/web/context/tests/.runs/manual-2026-11-09.jsonl";
  /** A case linked to a test that no CI or agent run reported: `linked`, whatever a human records. */
  const linked = () => ({
    ok: true as const,
    value: {
      ref: "web/TC-0001",
      path: "apps/web/context/tests/login/TC-0001.md",
      inherited: [],
      case: {
        id: "TC-0001",
        title: "Sign in",
        state: "active",
        priority: "P2",
        automation: { status: "manual", ref: "login.spec.ts::signs in", eligible: true },
        steps: [{ do: "Open the login page", expect: "The form shows" }],
      },
    },
  });
  let recordedRuns: Record<string, unknown>[] = [];
  const recorded = (status: string, extra: Record<string, unknown> = {}) => {
    const event = {
      run_id: "manual-2026-11-09",
      case_id: "TC-0001",
      status,
      executor: "human:qa@acme.example",
      at: "2026-11-09T10:00:00Z",
      ...extra,
    };
    recordedRuns = [{ ...event, path }, ...recordedRuns];
    return {
      ok: true as const,
      value: {
        ref: "web/TC-0001",
        run: "manual-2026-11-09",
        path,
        appended: true,
        event,
        commit: {
          message: `run(login): record TC-0001 as ${status}\n\nCasefile-Run: manual-2026-11-09`,
          files: [path],
          sha: "3333333ccccccc",
        },
        next: [],
      },
    };
  };
  const runCalls = () => calls.filter((c) => c.name === "run").map((c) => c.input);

  beforeEach(() => {
    recordedRuns = [];
    answers.resolve = linked;
    answers.runs = () => ({ ok: true, value: { ref: "web/TC-0001", runs: recordedRuns } });
  });

  it("records a passed result with one run call, then shows it; the automation badge stays", async () => {
    const user = userEvent.setup();
    answers.run = (input) => recorded(String(input.status));
    render(<CaseDetail caseRef="web/TC-0001" />);
    expect(await screen.findByText("Never ran.")).toBeTruthy();
    expect(screen.getByText("linked")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Record a result" }));
    const form = screen.getByRole("form", { name: "Record a result" });
    // Nothing is preselected, and the four results are the ones `run` takes.
    const result = within(form).getByLabelText("Result") as HTMLSelectElement;
    expect(result.value).toBe("");
    expect([...result.options].map((o) => o.value)).toEqual([
      "",
      "passed",
      "failed",
      "blocked",
      "skipped",
    ]);
    await user.selectOptions(result, "passed");
    await user.click(within(form).getByRole("button", { name: "Record" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Recorded passed in run manual-2026-11-09. Committed 3333333.");
    // Only what the QA filled is sent.
    expect(runCalls()).toEqual([{ ref: "web/TC-0001", status: "passed" }]);
    // The form closes and the list is read again: the new event is there.
    expect(screen.queryByRole("form", { name: "Record a result" })).toBeNull();
    expect(await screen.findByText("human:qa@acme.example")).toBeTruthy();
    expect(screen.queryByText("Never ran.")).toBeNull();
    // A human run proves nothing: the case is read again and is still only linked.
    expect(calls.filter((c) => c.name === "resolve")).toHaveLength(2);
    expect(screen.getByText("linked")).toBeTruthy();
    expect(screen.queryByText("automated")).toBeNull();
  });

  it("records a failed result with a multi-line note and where it ran", async () => {
    const user = userEvent.setup();
    answers.run = (input) => {
      const { ref: _ref, status, ...rest } = input;
      return recorded(String(status), rest);
    };
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Record a result" }));
    await user.selectOptions(screen.getByLabelText("Result"), "failed");
    await user.type(
      screen.getByLabelText("Note"),
      "  The banner says Something went wrong{Enter}instead of Wrong password  ",
    );
    await user.type(screen.getByLabelText("Environment"), " staging ");
    await user.type(screen.getByLabelText("Build"), "web-2.1.0+9");
    await user.click(screen.getByRole("button", { name: "Record" }));

    expect((await screen.findByRole("status")).textContent).toContain("Recorded failed");
    // The note keeps its line break; blank edges and empty fields are not sent.
    expect(runCalls()).toEqual([
      {
        ref: "web/TC-0001",
        status: "failed",
        note: "The banner says Something went wrong\ninstead of Wrong password",
        env: "staging",
        build: "web-2.1.0+9",
      },
    ]);
    const note = await screen.findByRole("region", {
      name: "Note of the failed run manual-2026-11-09",
    });
    expect(note.textContent).toBe(
      "The banner says Something went wrong\ninstead of Wrong password",
    );
    expect(screen.getByText("staging")).toBeTruthy();
    expect(screen.getByText("web-2.1.0+9")).toBeTruthy();
  });

  it("asks for a result before calling, and shows the operation's errors in place", async () => {
    const user = userEvent.setup();
    answers.run = () => ({
      ok: false,
      errors: [
        { code: "operation.invalid_input", field: "env", message: "Too big" },
        {
          code: "identity.missing",
          field: "identity",
          message: "no identity: set CASEFILE_USER_EMAIL",
        },
      ],
    });
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Record a result" }));
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByText("Choose what happened.")).toBeTruthy();
    expect(screen.getByLabelText("Result").getAttribute("aria-invalid")).toBe("true");
    expect(runCalls()).toEqual([]);

    await user.selectOptions(screen.getByLabelText("Result"), "blocked");
    expect(screen.queryByText("Choose what happened.")).toBeNull();
    await user.type(screen.getByLabelText("Environment"), "staging");
    await user.click(screen.getByRole("button", { name: "Record" }));

    // An error on a form input sits under it; any other shows whole.
    const under = (await screen.findByText("Too big")).closest('[data-slot="field"]');
    expect(under?.querySelector("input")?.value).toBe("staging");
    expect(under?.textContent).toContain("operation.invalid_input");
    expect(screen.getByLabelText("Environment").getAttribute("aria-invalid")).toBe("true");
    const whole = screen
      .getByText("no identity: set CASEFILE_USER_EMAIL")
      .closest('[role="alert"]');
    expect(whole?.textContent).toContain("identity.missing");
    // Nothing was recorded: the form stays with what the QA typed, and no status line.
    expect(screen.getByRole("form", { name: "Record a result" })).toBeTruthy();
    expect((screen.getByLabelText("Result") as HTMLSelectElement).value).toBe("blocked");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Never ran.")).toBeTruthy();
  });

  it("says so when the result was already recorded, and Cancel calls nothing", async () => {
    const user = userEvent.setup();
    answers.run = () => ({
      ok: true,
      value: {
        ref: "web/TC-0001",
        run: "manual-2026-11-09",
        path,
        appended: false,
        event: { status: "skipped" },
        next: [],
      },
    });
    render(<CaseDetail caseRef="web/TC-0001" />);
    await user.click(await screen.findByRole("button", { name: "Record a result" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Record a result" })).toBeNull();
    expect(runCalls()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Record a result" }));
    await user.selectOptions(screen.getByLabelText("Result"), "skipped");
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Already recorded: skipped is still this case's last result in run manual-2026-11-09. Nothing was written.",
    );
  });
});

describe("NewCase: create a case (#94)", () => {
  const covered = {
    ok: true as const,
    value: {
      project: "web",
      feature: "login",
      change: "c-9",
      created: [{ ref: "web/TC-0003", path: "apps/web/context/tests/login/TC-0003.md" }],
      commit: {
        message: "cover(login): TC-0003 Lock after five tries\n\nCasefile-Change: c-9",
        files: ["apps/web/context/tests/login/TC-0003.md"],
        sha: "3333333ccccccc",
      },
      next: [],
    },
  };
  const covers = () => calls.filter((c) => c.name === "cover").map((c) => c.input);
  const features = new Map([["web", ["login", "login/errors"]]]);

  it("creates one case with cover, sending only what was filled", async () => {
    const user = userEvent.setup();
    answers.cover = () => covered;
    const onCreated = vi.fn();
    render(
      <NewCase
        projects={["web"]}
        features={features}
        project="web"
        feature="login"
        onCreated={onCreated}
      />,
    );
    // The feature the list was on is filled in; one empty step is there to write.
    expect((screen.getByLabelText("Feature") as HTMLInputElement).value).toBe("login");
    expect(screen.queryByLabelText("Project")).toBeNull();

    await user.type(screen.getByLabelText("Title"), "Lock after five tries");
    await user.selectOptions(screen.getByLabelText("Priority"), "P1");
    await user.type(screen.getByLabelText("Step 1 action"), "Fail to sign in five times");
    await user.type(screen.getByLabelText("Step 1 expected result"), "The account is locked");
    await user.click(screen.getByRole("button", { name: "Add precondition" }));
    await user.type(screen.getByLabelText("Precondition 1"), "An account exists");
    await user.click(screen.getByRole("button", { name: "Add label" }));
    await user.type(screen.getByLabelText("Label 1 key"), "risk");
    await user.type(screen.getByLabelText("Label 1 value"), "auth");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(covered.value));
    // The server adds actor `human`, the identity and `via`; core writes `origin: human`.
    expect(covers()).toEqual([
      {
        project: "web",
        feature: "login",
        cases: [
          {
            title: "Lock after five tries",
            priority: "P1",
            preconditions: ["An account exists"],
            steps: [{ do: "Fail to sign in five times", expect: "The account is locked" }],
            labels: { risk: "auth" },
          },
        ],
      },
    ]);
  });

  it("puts a duplicate title, an undeclared label and a bad feature on their fields", async () => {
    const user = userEvent.setup();
    answers.cover = () => ({
      ok: false,
      errors: [
        {
          code: "cover.duplicate_title",
          field: "cases.0.title",
          message: "'Sign in' is already the title of TC-0001 in 'login'",
        },
        {
          code: "label.undeclared",
          field: "cases.0.labels.team",
          message: "label 'team' is not declared",
        },
        { code: "operation.invalid_input", field: "feature", message: "Invalid string" },
        { code: "git.commit_failed", message: "the commit failed" },
      ],
    });
    const onCreated = vi.fn();
    render(<NewCase projects={["web"]} features={features} project="web" onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Feature"), "Login Page");
    await user.type(screen.getByLabelText("Title"), "Sign in");
    await user.type(screen.getByLabelText("Step 1 action"), "Sign in");
    await user.type(screen.getByLabelText("Step 1 expected result"), "Home opens");
    await user.click(screen.getByRole("button", { name: "Add label" }));
    await user.type(screen.getByLabelText("Label 1 key"), "team");
    await user.type(screen.getByLabelText("Label 1 value"), "web");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const title = screen.getByLabelText("Title");
    await vi.waitFor(() => expect(title.getAttribute("aria-invalid")).toBe("true"));
    const fieldOf = (input: HTMLElement) => input.closest("[data-slot=field]") as HTMLElement;
    expect(within(fieldOf(title)).getByText("cover.duplicate_title")).toBeTruthy();
    const feature = screen.getByLabelText("Feature");
    expect(feature.getAttribute("aria-invalid")).toBe("true");
    expect(within(fieldOf(feature)).getByText("operation.invalid_input")).toBeTruthy();
    const label = screen.getByLabelText("Label 1 key");
    expect(label.getAttribute("aria-invalid")).toBe("true");
    expect(within(label.closest("li") as HTMLElement).getByText("label.undeclared")).toBeTruthy();
    // Any other error shows whole, above the form; nothing was created.
    expect(screen.getByText("the commit failed")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("asks for a project and a feature before calling, when the list showed every project", async () => {
    const user = userEvent.setup();
    render(<NewCase projects={["web", "api"]} features={features} onCreated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Choose a project.")).toBeTruthy();
    expect(screen.getByText("Name the feature.")).toBeTruthy();
    expect(covers()).toEqual([]);

    // Choosing the project offers its features as you type.
    await user.selectOptions(screen.getByLabelText("Project"), "web");
    const options = document.querySelectorAll("#case-features option");
    expect([...options].map((o) => o.getAttribute("value"))).toEqual(["login", "login/errors"]);
  });
});

describe("App: a new case from the list (#94)", () => {
  const row = (ref: string, title: string, state: string) => ({
    ref,
    project: "web",
    feature: "login",
    title,
    state,
    priority: "P1",
    automation: "manual",
    automation_ref: null,
    eligible: false,
    last_run: null,
    last_run_at: null,
  });

  it("opens the form in the selected feature, then the new case, listed in the tree", async () => {
    const user = userEvent.setup();
    let made = false;
    answers.overview = () => ({
      ok: true,
      value: {
        projects: [{ name: "web", path: "apps/web", cases: made ? 2 : 1, unresolved: 0 }],
        cases: [
          row("web/TC-0001", "Sign in", "active"),
          ...(made ? [row("web/TC-0003", "Lock after five tries", "draft")] : []),
        ],
      },
    });
    answers.cover = () => {
      made = true;
      return {
        ok: true,
        value: {
          project: "web",
          feature: "login",
          change: "c-9",
          created: [{ ref: "web/TC-0003", path: "apps/web/context/tests/login/TC-0003.md" }],
          commit: { message: "cover(login): TC-0003", files: [], sha: "3333333ccccccc" },
          next: [],
        },
      };
    };
    answers.resolve = () => ({
      ok: true,
      value: {
        ref: "web/TC-0003",
        path: "apps/web/context/tests/login/TC-0003.md",
        inherited: [],
        case: {
          id: "TC-0003",
          title: "Lock after five tries",
          state: "draft",
          origin: "human",
          priority: "P1",
          automation: { status: "manual", eligible: false },
          steps: [{ do: "Fail five times", expect: "Locked" }],
          history: [
            {
              event: "created",
              by: "qa@acme.example",
              via: "ui:cover",
              change: "c-9",
              commit: null,
            },
          ],
        },
      },
    });
    answers.runs = () => ({ ok: true, value: { ref: "web/TC-0003", runs: [] } });
    window.location.hash = "#/cases?project=web&feature=login";
    render(<App />);

    const link = await screen.findByRole("link", { name: "New case" });
    expect(link.getAttribute("href")).toBe("#/new?project=web&feature=login");
    await user.click(link);
    await user.type(await screen.findByLabelText("Title"), "Lock after five tries");
    await user.type(screen.getByLabelText("Step 1 action"), "Fail five times");
    await user.type(screen.getByLabelText("Step 1 expected result"), "Locked");
    await user.click(screen.getByRole("button", { name: "Create" }));

    // The new case's page opens and names the commit that created it.
    expect(await screen.findByRole("heading", { name: "Lock after five tries" })).toBeTruthy();
    expect(window.location.hash).toBe("#/case/web/TC-0003");
    expect(screen.getByRole("status").textContent).toContain("3333333");
    expect(screen.getAllByText("3333333").length).toBe(2);
    expect(calls.filter((c) => c.name === "overview")).toHaveLength(2);

    // Back on the list, the tree and the list read the workspace again.
    window.location.hash = "#/cases?project=web&feature=login";
    expect(await screen.findByRole("link", { name: "Lock after five tries" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Features" }).textContent).toContain("2");
  });
});

describe("QueryView", () => {
  it("runs the query in the selected project and points at a DSL error", async () => {
    answers.query = () => ({
      ok: false,
      errors: [{ code: "query.unexpected_end", field: "query", column: 8, message: "query ends" }],
    });
    render(<QueryView project="api" />);
    fireEvent.change(screen.getByLabelText("Query"), { target: { value: "state =" } });
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    expect(await screen.findByText("query ends")).toBeTruthy();
    expect(screen.getByText("column 8", { exact: false })).toBeTruthy();
    expect(screen.getByText(`${" ".repeat(7)}^`, { normalizer: (s) => s })).toBeTruthy();
    expect(calls).toEqual([{ name: "query", input: { query: "state =", project: "api" } }]);
  });

  it("forgets the last answer when the project changes", async () => {
    answers.overview = () => ({ ok: true, value: { projects: [], cases: [] } });
    answers.query = () => ({ ok: true, value: { count: 0, cases: [], unresolved: 0 } });
    window.location.hash = "#/query?project=web";
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Query"), {
      target: { value: "state = active" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    expect(await screen.findByText("0 cases")).toBeTruthy();
    window.location.hash = "#/query?project=api";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.waitFor(() => expect(screen.queryByText("0 cases")).toBeNull());
    expect((screen.getByLabelText("Query") as HTMLInputElement).value).toBe("");
  });
});

describe("App: who the QA acts as", () => {
  beforeEach(() => {
    answers.overview = () => ({ ok: true, value: { projects: [], cases: [] } });
  });

  it("names the identity and where it came from", async () => {
    answers.session = () => ({
      ok: true,
      value: { token: "t", identity: { email: "qa@acme.example", name: "QA Lead", source: "env" } },
    });
    render(<App />);
    const acting = await screen.findByText("Acting as QA Lead <qa@acme.example>");
    expect(acting.getAttribute("title")).toBe("from CASEFILE_USER_EMAIL");
  });

  it("warns when nobody is configured, before any write", async () => {
    answers.session = () => ({ ok: true, value: { token: "t", identity: null } });
    render(<App />);
    expect(await screen.findByText(/No identity: set CASEFILE_USER_EMAIL/)).toBeTruthy();
  });

  it("sends the session token with every call", async () => {
    const headers: unknown[] = [];
    answers.session = () => ({
      ok: true,
      value: { token: "secret", identity: { email: "qa@acme.example", source: "git" } },
    });
    const stubbed = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (init !== undefined) headers.push(init.headers);
      return stubbed(url, init);
    });
    render(<App />);
    await screen.findByText("Acting as qa@acme.example");
    await vi.waitFor(() => expect(headers).not.toHaveLength(0));
    expect(headers[0]).toMatchObject({ "x-casefile-token": "secret" });
  });
});

describe("ValidateView", () => {
  it("lists every finding when validate fails", async () => {
    answers.validate = () => ({
      ok: false,
      errors: [
        { code: "case.duplicate_id", severity: "error", path: "a/TC-0001.md", message: "dup" },
        { code: "label.undeclared", severity: "warning", path: "b/TC-0002.md", message: "label" },
      ],
    });
    render(<ValidateView project="web" />);
    expect(await screen.findByText("1 error, 1 warnings")).toBeTruthy();
    expect(screen.getByText("dup")).toBeTruthy();
    expect(calls).toEqual([{ name: "validate", input: { project: "web" } }]);
  });

  it("says the workspace is valid", async () => {
    answers.validate = () => ({
      ok: true,
      value: { projects: 2, cases: 3, warnings: 0, findings: [] },
    });
    render(<ValidateView />);
    expect(await screen.findByText("Valid")).toBeTruthy();
  });
});
