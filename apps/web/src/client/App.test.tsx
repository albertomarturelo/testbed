// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, RUN_COLUMNS_KEY } from "@/App";
import type { Overview } from "@/api";
import { featureTree } from "@/components/FeatureTree";
import { formatRoute, parseRoute } from "@/route";

const OVERVIEW: Overview = {
  projects: [
    { name: "web", path: "apps/web", cases: 2, unresolved: 1 },
    { name: "api", path: "services/api", cases: 1, unresolved: 0 },
  ],
  cases: [
    row("api/TC-0001", "orders", "Create an order", "automated", "passed"),
    row("web/TC-0001", "login", "Sign in", "automated", "failed"),
    row("web/TC-0002", "login/errors", "Reject a wrong password", "manual", null),
  ],
};

function row(ref: string, feature: string, title: string, automation: string, run: string | null) {
  return {
    ref,
    project: ref.split("/")[0] as string,
    feature,
    title,
    state: "active",
    priority: "P1",
    automation,
    automation_ref: automation === "automated" ? `${feature}.spec.ts::${title}` : null,
    eligible: true,
    last_run: run,
    last_run_at: run === null ? null : "2026-10-14T07:00:00Z",
  };
}

const calls: { name: string; input: unknown }[] = [];
let overview: Overview = OVERVIEW;

beforeEach(() => {
  calls.length = 0;
  overview = OVERVIEW;
  window.localStorage.clear();
  window.location.hash = "";
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const name = url.split("/").at(-1) as string;
    calls.push({ name, input: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, value: overview }));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the projects and every case from overview", async () => {
    render(<App />);
    expect(await screen.findByText("Reject a wrong password")).toBeTruthy();
    expect(screen.getByText("Create an order")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Projects" }).textContent).toContain("web");
    expect(screen.getByText("never ran")).toBeTruthy();
    expect(calls).toEqual([{ name: "overview", input: {} }]);
  });

  it("filters by the project and feature in the URL hash", async () => {
    window.location.hash = formatRoute({ view: "cases", project: "web", feature: "login/errors" });
    render(<App />);
    expect(await screen.findByText("Reject a wrong password")).toBeTruthy();
    expect(screen.queryByText("Sign in")).toBeNull();
    expect(screen.queryByText("Create an order")).toBeNull();
    // The case file that does not resolve is pointed out.
    expect(screen.getByText(/does not resolve/)).toBeTruthy();
  });
});

describe("App: drafts awaiting review (#87)", () => {
  const withDrafts = (): Overview => ({
    projects: OVERVIEW.projects,
    cases: [
      ...OVERVIEW.cases,
      { ...row("web/TC-0003", "login", "Lock after five tries", "manual", null), state: "draft" },
      {
        ...row("web/TC-0004", "login/errors", "Reject an empty form", "manual", null),
        state: "draft",
      },
      { ...row("web/TC-0005", "login", "Old flow", "manual", null), state: "retired" },
    ],
  });
  const toggle = () => screen.getByRole("button", { name: /Drafts awaiting review/ });

  it("counts the drafts in scope in the header and lists only them when pressed", async () => {
    overview = withDrafts();
    window.location.hash = formatRoute({ view: "cases", project: "web" });
    render(<App />);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(toggle().textContent).toContain("2");

    fireEvent.click(toggle());
    expect(window.location.hash).toBe("#/cases?project=web&state=draft");
    // The App follows the hash on `hashchange`: wait for the filtered list.
    await waitFor(() => expect(screen.queryByText("Sign in")).toBeNull());
    expect(screen.getByText("Lock after five tries")).toBeTruthy();
    expect(screen.queryByText("Old flow")).toBeNull();
    expect(screen.getByText("Reject an empty form")).toBeTruthy();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");

    // The tree and the group headings keep the filter; the tree still counts every case.
    const tree = screen.getByRole("navigation", { name: "Features" });
    const errors = [...tree.querySelectorAll("a")].find((a) => a.textContent?.startsWith("errors"));
    expect(errors?.getAttribute("href")).toBe(
      "#/cases?project=web&feature=login%2Ferrors&state=draft",
    );
    expect(tree.textContent).toContain("All features · 5");
    expect(screen.getByRole("link", { name: "login" }).getAttribute("href")).toBe(
      "#/cases?project=web&feature=login&state=draft",
    );

    fireEvent.click(toggle());
    expect(window.location.hash).toBe("#/cases?project=web");
    expect(await screen.findByText("Sign in")).toBeTruthy();
  });

  it("counts within the selected feature and says when none wait", async () => {
    overview = withDrafts();
    window.location.hash = formatRoute({
      view: "cases",
      project: "web",
      feature: "login/errors",
      state: "draft",
    });
    render(<App />);
    expect(await screen.findByText("Reject an empty form")).toBeTruthy();
    expect(toggle().textContent).toContain("1");
    cleanup();

    overview = OVERVIEW;
    render(<App />);
    expect(await screen.findByText("No drafts await review here.")).toBeTruthy();
    expect(toggle().textContent).toContain("0");
  });
});

describe("App: room for the title (#109)", () => {
  const featureHeader = () => screen.queryByRole("columnheader", { name: "Feature" });

  it("keeps the plain table for a leaf, groups a parent and all features (#112)", async () => {
    const heading = (feature: string) => screen.queryByRole("link", { name: feature });
    window.location.hash = formatRoute({ view: "cases", project: "web", feature: "login/errors" });
    const { unmount } = render(<App />);
    expect(await screen.findByText("Reject a wrong password")).toBeTruthy();
    expect(featureHeader()).toBeNull();
    expect(heading("login/errors")).toBeNull();
    unmount();

    for (const feature of ["login", undefined]) {
      window.location.hash = formatRoute({ view: "cases", project: "web", feature });
      const view = render(<App />);
      expect(await screen.findByText("Reject a wrong password")).toBeTruthy();
      // The group heading names the feature, so no row repeats it in a column.
      expect(featureHeader()).toBeNull();
      expect(heading("login")?.getAttribute("href")).toBe("#/cases?project=web&feature=login");
      expect(heading("login/errors")).not.toBeNull();
      view.unmount();
    }
  });

  it("shows no project switcher in a one-project workspace", async () => {
    render(<App />);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Projects" })).toBeTruthy();
    cleanup();

    overview = {
      projects: [OVERVIEW.projects[0] as Overview["projects"][number]],
      cases: OVERVIEW.cases.filter((c) => c.project === "web"),
    };
    render(<App />);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Projects" })).toBeNull();
    expect(screen.queryByText("All projects")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Views" })).toBeTruthy();
  });
});

describe("App: run columns are optional (#110)", () => {
  const heads = () => screen.getAllByRole("columnheader").map((h) => h.textContent);

  it("leaves Last run out when no case of the project ever ran", async () => {
    overview = {
      ...OVERVIEW,
      cases: OVERVIEW.cases.map((c) => ({ ...c, last_run: null, last_run_at: null })),
    };
    render(<App />);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(heads()).toContain("Automation");
    expect(heads()).not.toContain("Last run");
    expect(screen.queryByText("never ran")).toBeNull();
  });

  it("reads runs over the project, not the selected feature", async () => {
    // login/errors never ran, but login did: the column stays.
    window.location.hash = formatRoute({ view: "cases", project: "web", feature: "login/errors" });
    render(<App />);
    expect(await screen.findByText("Reject a wrong password")).toBeTruthy();
    expect(heads()).toContain("Last run");
  });

  it("hides automation and runs on request and remembers it for this viewer", async () => {
    const view = render(<App />);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide automation and runs" }));
    expect(heads()).not.toContain("Automation");
    expect(heads()).not.toContain("Last run");
    expect(window.localStorage.getItem(RUN_COLUMNS_KEY)).toBe("0");

    view.unmount();
    render(<App />);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(heads()).not.toContain("Automation");
    fireEvent.click(screen.getByRole("button", { name: "Show automation and runs" }));
    expect(heads()).toEqual(expect.arrayContaining(["Automation", "Last run"]));
    expect(window.localStorage.getItem(RUN_COLUMNS_KEY)).toBe("1");
  });

  it("renders the list when storage throws, and the toggle still works", async () => {
    const broken = () => {
      throw new Error("blocked");
    };
    vi.spyOn(window.localStorage, "getItem").mockImplementation(broken);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(broken);
    try {
      render(<App />);
      expect(await screen.findByText("Sign in")).toBeTruthy();
      expect(heads()).toContain("Automation");
      fireEvent.click(screen.getByRole("button", { name: "Hide automation and runs" }));
      expect(heads()).not.toContain("Automation");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("routes and feature tree", () => {
  it("round-trips every view through the hash", () => {
    for (const route of [
      { view: "cases" as const, project: "web", feature: "login" },
      { view: "cases" as const, project: "web", feature: "login", state: "draft" as const },
      { view: "case" as const, ref: "web/TC-0001" },
      { view: "query" as const, project: "api" },
      { view: "validate" as const },
    ]) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
    expect(parseRoute("")).toEqual({ view: "cases" });
    // Drafts awaiting review is the only state filter the page shows (#87).
    expect(parseRoute("#/cases?state=active")).toEqual({ view: "cases" });
  });

  it("nests features by `/`, counting the cases below each by state and linked (#87)", () => {
    expect(featureTree(OVERVIEW.cases)).toEqual([
      {
        name: "login",
        path: "login",
        count: 2,
        tally: { states: { active: 2 }, linked: 1 },
        children: [
          {
            name: "errors",
            path: "login/errors",
            count: 1,
            tally: { states: { active: 1 }, linked: 0 },
            children: [],
          },
        ],
      },
      {
        name: "orders",
        path: "orders",
        count: 1,
        tally: { states: { active: 1 }, linked: 1 },
        children: [],
      },
    ]);
  });
});
