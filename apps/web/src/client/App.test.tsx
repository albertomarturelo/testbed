// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
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
    last_run: run,
    last_run_at: run === null ? null : "2026-10-14T07:00:00Z",
  };
}

const calls: { name: string; input: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  window.location.hash = "";
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const name = url.split("/").at(-1) as string;
    calls.push({ name, input: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, value: OVERVIEW }));
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

describe("routes and feature tree", () => {
  it("round-trips every view through the hash", () => {
    for (const route of [
      { view: "cases" as const, project: "web", feature: "login" },
      { view: "case" as const, ref: "web/TC-0001" },
      { view: "query" as const, project: "api" },
      { view: "validate" as const },
    ]) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
    expect(parseRoute("")).toEqual({ view: "cases" });
  });

  it("nests features by `/` and counts the cases below each", () => {
    expect(featureTree(OVERVIEW.cases)).toEqual([
      {
        name: "login",
        path: "login",
        count: 2,
        children: [{ name: "errors", path: "login/errors", count: 1, children: [] }],
      },
      { name: "orders", path: "orders", count: 1, children: [] },
    ]);
  });
});
