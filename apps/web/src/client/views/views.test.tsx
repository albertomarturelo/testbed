// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import type { Result } from "@/api";
import { CaseDetail } from "@/views/CaseDetail";
import { QueryView } from "@/views/QueryView";
import { ValidateView } from "@/views/ValidateView";

/** What the fake API answers, per operation; inputs are recorded in `calls`. */
let answers: Record<string, (input: Record<string, unknown>) => Result<unknown>> = {};
const calls: { name: string; input: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = {};
  window.location.hash = "";
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const name = url.split("/").at(-1) as string;
    const input = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ name, input });
    const answer = answers[name]?.(input) ?? { ok: false, errors: [{ code: "x", message: name }] };
    return new Response(JSON.stringify(answer));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CaseDetail", () => {
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
    expect(screen.getByText("test-results/x/error-context.md")).toBeTruthy();
    expect(screen.getByText("ci:github-actions")).toBeTruthy();
    expect(screen.getByText("30.0 s")).toBeTruthy();
    expect(screen.getByText("web-2.1.0+9")).toBeTruthy();
    const times = screen.getAllByRole("time").map((t) => t.getAttribute("datetime"));
    expect(times).toEqual(["2026-10-17T19:23:06Z", "2026-10-10T08:00:00Z"]);
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("passed")).toBeTruthy();
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
