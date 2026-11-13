// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "@/App";
import { formatRoute } from "@/route";

// A tab left open across an upgrade asks for a chunk the server no longer has (#187).
vi.mock("@/views/Dashboards", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ ok: true, value: { projects: [], cases: [] } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

it("says the dashboards view did not load, and the rest of the viewer stays", async () => {
  window.location.hash = formatRoute({ view: "dashboard", project: "web", slug: "overview" });
  render(<App />);
  expect(await screen.findByText(/the dashboards view did not load/)).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Views" })).toBeTruthy();
});
