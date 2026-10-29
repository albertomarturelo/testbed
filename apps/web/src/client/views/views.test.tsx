// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, RUN_COLUMNS_KEY } from "@/App";
import { type CaseRow, forgetSession, type Result } from "@/api";
import { FeatureTree, featureOpenKey } from "@/components/FeatureTree";
import { CaseDetail } from "@/views/CaseDetail";
import { CaseList } from "@/views/CaseList";
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
  const shown = (name: string) => screen.queryByRole("link", { name }) !== null;

  it("gives every parent a chevron button apart from its link, open by default", () => {
    render(<FeatureTree project="web" rows={rows} selected="billing" />);
    expect(toggle("auth").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("auth/login").getAttribute("aria-expanded")).toBe("true");
    // A leaf has no chevron, and the button is not inside the link.
    expect(screen.queryByRole("button", { name: "Features under billing" })).toBeNull();
    expect(toggle("auth").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "auth 3" }).getAttribute("href")).toBe(
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
          acceptance_ref: ["ACME-101#AC-1", "https://tracker.example/ACME-101#ac-2"],
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
    expect(screen.getByText("ACME-101#AC-1").closest("a")).toBeNull();
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
