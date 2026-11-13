import type { FileSchemaName } from "./index.js";

export interface Sample {
  name: string;
  value: unknown;
}

const change = "3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44";
const created = {
  at: "2026-10-15T10:00:00Z",
  by: "ana@example.com",
  via: "cli:cover",
  change,
  event: "created",
};

const minimalCase = {
  id: "TC-0001",
  feature: "payments/refunds",
  title: "Refund a captured card payment",
  state: "draft",
  origin: "agent",
  steps: [{ do: "Request a refund of {{data.amount}}", expect: "Refund is accepted" }],
  history: [created],
};

const fullCase = {
  ...minimalCase,
  acceptance_ref: ["PROJ-1234#AC-5"],
  surfaces: ["web", "api"],
  layer: "e2e",
  automation: { eligible: true, status: "candidate", ref: "refunds.spec.ts::refund captured" },
  priority: "P1",
  labels: { risk: "payments", owner_team: "billing", smoke: true, tags: ["money"] },
  preconditions: ["A captured payment exists"],
  data: { amount: 10.5 },
  work_items: ["sprint:23", "story:PROJ-1234", "release:web-4.12.0"],
  duplicates_checked_against: ["TC-0002"],
  mirror: { zephyr: "PROJ-T12", synced_at: "2026-10-15T11:00:00+02:00", hash: "a".repeat(64) },
  history: [created, { ...created, event: "reviewed", inbox: "in-42", note: "LGTM" }],
};

const without = (obj: Record<string, unknown>, key: string) => {
  const { [key]: _, ...rest } = obj;
  return rest;
};

const runEvent = {
  run_id: "2026-10-15-smoke-web",
  case_id: "TC-0001",
  status: "failed",
  executor: "ci:github-actions",
  at: "2026-10-15T12:00:00Z",
};

export const samples: Record<FileSchemaName, { valid: Sample[]; invalid: Sample[] }> = {
  "test-case": {
    valid: [
      { name: "minimal", value: minimalCase },
      { name: "all fields", value: fullCase },
    ],
    invalid: [
      { name: "id with three digits", value: { ...minimalCase, id: "TC-001" } },
      { name: "feature with uppercase", value: { ...minimalCase, feature: "Payments" } },
      { name: "unknown state", value: { ...minimalCase, state: "approved" } },
      {
        name: "stored automated status (derived only)",
        value: { ...minimalCase, automation: { status: "automated" } },
      },
      { name: "no steps", value: { ...minimalCase, steps: [] } },
      { name: "no history", value: { ...minimalCase, history: [] } },
      { name: "missing title", value: without(minimalCase, "title") },
      {
        name: "history stores commit instead of change",
        value: { ...minimalCase, history: [{ ...without(created, "change"), commit: "abc123" }] },
      },
      { name: "unknown top-level key", value: { ...minimalCase, owner: "ana" } },
      { name: "bad work item", value: { ...minimalCase, work_items: ["sprint 23"] } },
      { name: "label key with dash", value: { ...minimalCase, labels: { "owner-team": "x" } } },
      {
        name: "timestamp without offset",
        value: { ...minimalCase, history: [{ ...created, at: "2026-10-15T10:00:00" }] },
      },
      { name: "unknown surface", value: { ...minimalCase, surfaces: ["tv"] } },
    ],
  },
  common: {
    valid: [
      { name: "empty", value: {} },
      {
        name: "all fields",
        value: {
          surfaces: ["mobile-ios", "mobile-android"],
          layer: "e2e",
          priority: "P2",
          automation: { eligible: true },
          labels: { risk: "payments" },
          preconditions: ["User is logged in"],
          data: { user: "qa+1@example.com" },
          review: { mode: "required", reviewers: ["lead@example.com"], max_batch: 5 },
          context_refs: ["context/payments.md"],
        },
      },
    ],
    invalid: [
      { name: "unknown review mode", value: { review: { mode: "sometimes" } } },
      { name: "max_batch zero", value: { review: { mode: "auto", max_batch: 0 } } },
      { name: "automation.status is per case", value: { automation: { status: "manual" } } },
      { name: "work items are not inheritable", value: { work_items: ["sprint:23"] } },
    ],
  },
  properties: {
    valid: [
      {
        name: "every type",
        value: {
          properties: {
            risk: {
              type: "enum",
              values: ["payments", "auth", "low"],
              default: "low",
              mirror: { zephyr: "customfield_10042" },
            },
            owner_team: { type: "string", description: "Team owning the feature" },
            effort: { type: "number", default: 1 },
            smoke: { type: "boolean", default: false },
            tags: { type: "list", values: ["money", "pii"] },
          },
        },
      },
    ],
    invalid: [
      { name: "enum without values", value: { properties: { risk: { type: "enum" } } } },
      { name: "unknown type", value: { properties: { risk: { type: "date" } } } },
      {
        name: "default of the wrong type",
        value: { properties: { smoke: { type: "boolean", default: "no" } } },
      },
      { name: "missing properties key", value: {} },
    ],
  },
  "run-event": {
    valid: [
      { name: "minimal", value: runEvent },
      {
        name: "all fields",
        value: {
          ...runEvent,
          surface: "web",
          env: "staging",
          build: "web-1.2.0+45",
          release: "release:web-1.2.0",
          duration_ms: 1234,
          step_results: [{ step: 1, status: "failed", note: "500 from refunds API" }],
          evidence: [{ kind: "screenshot", ref: "artifacts/tc-0001.png", sha256: "b".repeat(64) }],
          automation_ref: "refunds.spec.ts::refund captured",
          note: "Error: 500 from refunds API",
          triage: { kind: "defect", by: "ana@example.com", ref: "PROJ-99", expires: "2026-11-01" },
        },
      },
    ],
    invalid: [
      { name: "executor without kind", value: { ...runEvent, executor: "ana@example.com" } },
      { name: "unknown status", value: { ...runEvent, status: "ok" } },
      { name: "run id with slash", value: { ...runEvent, run_id: "a/b" } },
      { name: "negative duration", value: { ...runEvent, duration_ms: -1 } },
      { name: "empty note", value: { ...runEvent, note: "" } },
      { name: "note over 2000 characters", value: { ...runEvent, note: "x".repeat(2001) } },
      {
        name: "step index zero",
        value: { ...runEvent, step_results: [{ step: 0, status: "passed" }] },
      },
      {
        name: "short sha256",
        value: { ...runEvent, evidence: [{ kind: "log", ref: "x", sha256: "abc" }] },
      },
      {
        name: "unknown triage kind",
        value: { ...runEvent, triage: { kind: "wontfix", by: "a@b.c" } },
      },
    ],
  },
  "inbox-item": {
    valid: [
      {
        name: "pending cover intent",
        value: {
          id: "in-42",
          kind: "cover",
          target: "payments/refunds",
          payload: { acceptance_ref: "PROJ-1234#AC-5" },
          by: "ana@example.com",
          at: "2026-10-15T09:00:00Z",
          status: "pending",
        },
      },
      {
        name: "done with result",
        value: {
          id: "in-43",
          kind: "review",
          target: "TC-0001",
          by: "ana@example.com",
          at: "2026-10-15T09:00:00Z",
          status: "done",
          result: { change },
        },
      },
    ],
    invalid: [
      {
        name: "result stores commit",
        value: {
          id: "in-44",
          kind: "run",
          target: "TC-0001",
          by: "ana@example.com",
          at: "2026-10-15T09:00:00Z",
          status: "done",
          result: { commit: "abc123" },
        },
      },
      {
        name: "kind with uppercase",
        value: {
          id: "in-45",
          kind: "Cover",
          target: "x",
          by: "ana@example.com",
          at: "2026-10-15T09:00:00Z",
          status: "pending",
        },
      },
      {
        name: "unknown status",
        value: {
          id: "in-46",
          kind: "ask",
          target: "x",
          by: "ana@example.com",
          at: "2026-10-15T09:00:00Z",
          status: "queued",
        },
      },
    ],
  },
  dashboard: {
    valid: [
      {
        name: "one stat",
        value: { title: "Overview", widgets: [{ id: "total", title: "Cases", type: "stat" }] },
      },
      {
        name: "every widget type",
        value: {
          title: "Web 1.2.0",
          description: "What the release looks like.",
          widgets: [
            { id: "active", title: "Active", type: "stat", query: "state = active", width: 3 },
            { id: "by-priority", title: "By priority", type: "bar", group_by: "priority" },
            {
              id: "results",
              title: "Results",
              type: "donut",
              milestone: "web-1.2.0",
              group_by: "last_result",
              width: 4,
            },
            {
              id: "failed",
              title: "Failed",
              type: "table",
              query: "labels.risk = payments",
              columns: ["title", "priority", "last_result"],
              limit: 20,
            },
            { id: "trend", title: "Executions", type: "timeseries", days: 14, width: 12 },
          ],
        },
      },
    ],
    invalid: [
      { name: "no widgets", value: { title: "Overview", widgets: [] } },
      { name: "no title", value: { widgets: [{ id: "a", title: "A", type: "stat" }] } },
      {
        name: "unknown widget type",
        value: { title: "O", widgets: [{ id: "a", title: "A", type: "gauge" }] },
      },
      {
        name: "bar without group_by",
        value: { title: "O", widgets: [{ id: "a", title: "A", type: "bar" }] },
      },
      {
        name: "stat with group_by",
        value: { title: "O", widgets: [{ id: "a", title: "A", type: "stat", group_by: "state" }] },
      },
      {
        name: "table without columns",
        value: { title: "O", widgets: [{ id: "a", title: "A", type: "table", columns: [] }] },
      },
      {
        name: "width over the grid",
        value: { title: "O", widgets: [{ id: "a", title: "A", type: "stat", width: 13 }] },
      },
      {
        name: "coordinates",
        value: { title: "O", widgets: [{ id: "a", title: "A", type: "stat", x: 0, y: 0 }] },
      },
      {
        name: "id not a slug",
        value: { title: "O", widgets: [{ id: "By Priority", title: "A", type: "stat" }] },
      },
      {
        name: "group_by an expression",
        value: {
          title: "O",
          widgets: [{ id: "a", title: "A", type: "bar", group_by: "count(state)" }],
        },
      },
    ],
  },
  milestone: {
    valid: [
      { name: "minimal open", value: { title: "Sprint 23 regression", state: "open" } },
      {
        name: "a closed release",
        value: {
          title: "Web 1.2.0",
          state: "closed",
          due: "2026-10-20",
          release: "web-1.2.0",
          scope: "priority IN (P0, P1) and state = active",
          opened: {
            at: "2026-10-10T09:00:00Z",
            by: "qa@example.com",
            change: "11111111-1111-4111-8111-111111111111",
          },
          closed: {
            at: "2026-10-20T17:00:00Z",
            by: "lead@example.com",
            change: "22222222-2222-4222-8222-222222222222",
          },
        },
      },
    ],
    invalid: [
      { name: "no state", value: { title: "Web 1.2.0" } },
      { name: "unknown state", value: { title: "Web 1.2.0", state: "done" } },
      { name: "title on two lines", value: { title: "Web\n1.2.0", state: "open" } },
      { name: "due not a date", value: { title: "Web 1.2.0", state: "open", due: "next week" } },
      { name: "unknown field", value: { title: "Web 1.2.0", state: "open", owner: "qa" } },
    ],
  },
  "release-policy": {
    valid: [
      {
        name: "two gates and sign-off",
        value: {
          gates: [
            {
              name: "payments-regression",
              scope: "labels.risk = payments AND state = active",
              require: { executed: 100, passed: 95, failures: "triaged", build: "current" },
            },
            {
              name: "smoke",
              scope: "labels.smoke = true",
              require: { executed: 100, failures: "none", executor: ["ci"], source: "automated" },
            },
          ],
          sign_off: [{ role: "qa-lead", people: ["lead@example.com"] }],
        },
      },
    ],
    invalid: [
      { name: "no gates", value: { gates: [] } },
      {
        name: "percent over 100",
        value: { gates: [{ name: "g", scope: "state = active", require: { passed: 120 } }] },
      },
      {
        name: "unknown executor kind",
        value: { gates: [{ name: "g", scope: "x = 1", require: { executor: ["robot"] } }] },
      },
      { name: "gate without scope", value: { gates: [{ name: "g", require: {} }] } },
    ],
  },
  config: {
    valid: [
      { name: "after init, no projects yet", value: { version: 1, projects: [] } },
      {
        name: "single-project repo",
        value: { version: 1, projects: [{ name: "app", path: "." }] },
      },
      {
        name: "monorepo with extensions and workspace commons",
        value: {
          version: 1,
          projects: [
            { name: "web", path: "apps/web" },
            { name: "api", path: "services/api" },
          ],
          extensions: ["@acme/casefile-org", "casefile-ingest-x"],
          commons: { labels: { owner_team: "platform" }, preconditions: ["VPN is up"] },
        },
      },
    ],
    invalid: [
      { name: "missing version", value: { projects: [] } },
      { name: "missing projects", value: { version: 1 } },
      { name: "version 2", value: { version: 2, projects: [] } },
      { name: "project without path", value: { version: 1, projects: [{ name: "web" }] } },
      {
        name: "project name not a slug",
        value: { version: 1, projects: [{ name: "Web", path: "." }] },
      },
      {
        name: "invalid package name",
        value: { version: 1, projects: [], extensions: ["Not A Package"] },
      },
      {
        name: "unknown key in commons",
        value: { version: 1, projects: [], commons: { owner: "x" } },
      },
    ],
  },
};
