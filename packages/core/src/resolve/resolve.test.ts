import { describe, expect, it } from "vitest";
import {
  DEMO_EXPECTED,
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  DEMO_ROOT,
} from "../demo.fixture.js";
import type { LoadedCase } from "../load/parse.js";
import { type LoadedWorkspace, loadWorkspace } from "../load/workspace.js";
import type { CommonFile, RunEvent, TestCaseFile } from "../schema/index.js";
import {
  type CommonsLayer,
  caseRef,
  commonsChain,
  extensionLayer,
  type ResolveContext,
  type ResolvedCase,
  resolveCase,
  resolveWorkspace,
  workspaceLayer,
} from "./resolve.js";

const PATH = "context/tests/a/TC-0001.md";
const CHANGE = "3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44";

const FILE: TestCaseFile = {
  id: "TC-0001",
  feature: "a",
  title: "A case",
  state: "active",
  origin: "agent",
  steps: [{ do: "Do", expect: "Done" }],
  history: [
    {
      at: "2026-10-15T10:00:00Z",
      by: "ana@example.com",
      via: "cli:cover",
      change: CHANGE,
      event: "created",
    },
  ],
};

const ROOT: CommonsLayer = {
  origin: "context/tests/_common.yaml",
  commons: { surfaces: ["web"], layer: "e2e", priority: "P2", automation: { eligible: false } },
};

const RUN: RunEvent = {
  run_id: "r1",
  case_id: "TC-0001",
  status: "failed",
  executor: "ci:github-actions",
  at: "2026-10-15T12:00:00Z",
  automation_ref: "a.spec.ts::does",
};

function resolve(file: Partial<TestCaseFile>, context: Partial<ResolveContext> = {}) {
  const loaded: LoadedCase = { path: PATH, file: { ...FILE, ...file }, body: "" };
  return resolveCase(loaded, {
    project: "app",
    layers: [ROOT],
    runs: [],
    commitFor: () => null,
    ...context,
  });
}

function resolved(
  file: Partial<TestCaseFile>,
  context: Partial<ResolveContext> = {},
): ResolvedCase {
  const result = resolve(file, context);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

const layer = (origin: string, commons: CommonFile): CommonsLayer => ({ origin, commons });

describe("resolveCase: inheritance", () => {
  it("takes scalars from the innermost level that sets them", () => {
    const c = resolved(
      { priority: "P0" },
      { layers: [ROOT, layer("context/tests/a/_common.yaml", { layer: "api" })] },
    );
    expect(c).toMatchObject({
      surfaces: ["web"],
      layer: "api",
      priority: "P0",
      automation: { eligible: false },
    });
    expect(c.origins).toMatchObject({
      surfaces: "context/tests/_common.yaml",
      layer: "context/tests/a/_common.yaml",
      priority: PATH,
      "automation.eligible": "context/tests/_common.yaml",
    });
  });

  it("replaces surfaces as a whole, never concatenates them", () => {
    expect(resolved({ surfaces: ["api"] }).surfaces).toEqual(["api"]);
  });

  it("prepends inherited preconditions and records each origin", () => {
    const c = resolved(
      { preconditions: ["case"] },
      {
        layers: [
          { ...ROOT, commons: { ...ROOT.commons, preconditions: ["root"] } },
          layer("mid", { preconditions: ["mid"] }),
        ],
      },
    );
    expect(c.preconditions).toEqual(["root", "mid", "case"]);
    expect(c.origins).toMatchObject({
      "preconditions.0": ROOT.origin,
      "preconditions.1": "mid",
      "preconditions.2": PATH,
    });
  });

  it("merges labels and data per key, inner keys winning", () => {
    const c = resolved(
      { labels: { risk: "high" }, data: { user: "case" } },
      {
        layers: [
          ROOT,
          layer("mid", { labels: { risk: "low", team: "qa" }, data: { user: "mid", url: "u" } }),
        ],
      },
    );
    expect(c.labels).toEqual({ risk: "high", team: "qa" });
    expect(c.data).toEqual({ user: "case", url: "u" });
    expect(c.origins).toMatchObject({
      "labels.risk": PATH,
      "labels.team": "mid",
      "data.user": PATH,
      "data.url": "mid",
    });
  });

  it("reports org-level origins as ext:<package>@<version>", () => {
    const org = extensionLayer("@acme/casefile-commons", "1.2.0", { labels: { org: "acme" } });
    expect(org.origin).toBe("ext:@acme/casefile-commons@1.2.0");
    expect(resolved({}, { layers: [org, ROOT] }).origins["labels.org"]).toBe(
      "ext:@acme/casefile-commons@1.2.0",
    );
  });

  it("does not mutate the commons it reads", () => {
    const commons: CommonFile = {
      ...ROOT.commons,
      labels: { a: "1", tags: ["x"] },
      data: { user: { name: "ana" } },
      preconditions: ["p"],
    };
    const c = resolved(
      { surfaces: ["api"], labels: { b: "2" } },
      { layers: [layer("root", commons)] },
    );
    c.labels.c = "3";
    (c.labels.tags as string[]).push("y");
    (c.data.user as { name: string }).name = "bob";
    c.preconditions.push("q");
    expect(commons).toMatchObject({
      surfaces: ["web"],
      labels: { a: "1", tags: ["x"] },
      data: { user: { name: "ana" } },
      preconditions: ["p"],
    });
  });

  it("defaults labels, data and preconditions to empty", () => {
    expect(resolved({})).toMatchObject({ labels: {}, data: {}, preconditions: [] });
  });

  it("reports every required field nobody sets", () => {
    const result = resolve({}, { layers: [] });
    expect(result.ok || result.errors.map((e) => e.field)).toEqual([
      "surfaces",
      "layer",
      "priority",
      "automation.eligible",
    ]);
    expect(result.ok || result.errors[0]).toMatchObject({
      code: "resolve.missing_field",
      path: PATH,
    });
  });
});

describe("resolveCase: derivations", () => {
  const ref = RUN.automation_ref;

  it("is automated when a CI or agent run matches the ref, even a failed one", () => {
    expect(
      resolved({ automation: { status: "in_progress", ref } }, { runs: [RUN] }).automation.status,
    ).toBe("automated");
    const agentRun = { ...RUN, executor: "agent:claude-code" };
    expect(resolved({ automation: { ref } }, { runs: [agentRun] }).automation.status).toBe(
      "automated",
    );
  });

  it("ignores human runs and runs with another ref", () => {
    const runs = [
      { ...RUN, executor: "human:ana@example.com" },
      { ...RUN, automation_ref: "other" },
    ];
    expect(resolved({ automation: { status: "candidate", ref } }, { runs }).automation.status).toBe(
      "candidate",
    );
  });

  it("keeps the stored status without a ref, defaulting to manual", () => {
    expect(resolved({}, { runs: [RUN] }).automation).toEqual({ eligible: false, status: "manual" });
  });

  it("keeps a retired automation retired", () => {
    expect(
      resolved({ automation: { status: "retired", ref } }, { runs: [RUN] }).automation.status,
    ).toBe("retired");
  });

  it("derives history[].commit from the change id", () => {
    const commitFor = (change: string) => (change === CHANGE ? "abc123" : null);
    const c = resolved(
      {
        history: [
          ...FILE.history,
          {
            at: "2026-10-16T10:00:00Z",
            by: "lead@example.com",
            via: "web:review",
            change: "0b9d1c2e-5f3a-4c7b-8d2e-1a2b3c4d5e03",
            event: "reviewed",
          },
        ],
      },
      { commitFor },
    );
    expect(c.history.map((h) => h.commit)).toEqual(["abc123", null]);
  });
});

describe("commonsChain", () => {
  const commons = new Map<string, CommonFile>([
    ["context/tests/_common.yaml", { layer: "e2e" }],
    ["context/tests/a/b/_common.yaml", { layer: "api" }],
    ["context/tests/ab/_common.yaml", { layer: "ui" }],
    ["apps/web/context/tests/_common.yaml", { layer: "ui" }],
    ["apps/web/context/tests/a/_common.yaml", { layer: "ui" }],
  ]);

  it("lists existing commons from the project root down to the case folder", () => {
    expect(commonsChain(commons, ".", "context/tests/a/b/TC-0001.md").map((l) => l.origin)).toEqual(
      ["context/tests/_common.yaml", "context/tests/a/b/_common.yaml"],
    );
  });

  it("only uses the root for a case at the top level", () => {
    expect(commonsChain(commons, ".", "context/tests/TC-0001.md").map((l) => l.origin)).toEqual([
      "context/tests/_common.yaml",
    ]);
  });

  it("stays inside the project directory", () => {
    const chain = commonsChain(commons, "apps/web", "apps/web/context/tests/a/TC-0001.md");
    expect(chain.map((l) => l.origin)).toEqual([
      "apps/web/context/tests/_common.yaml",
      "apps/web/context/tests/a/_common.yaml",
    ]);
  });
});

describe("workspaceLayer", () => {
  it("is empty without workspace commons", () => {
    expect(workspaceLayer(null)).toEqual([]);
    expect(workspaceLayer({ version: 1, projects: [] })).toEqual([]);
  });

  it("reports casefile.yaml as the origin", () => {
    const commons = { layer: "e2e" } as const;
    expect(workspaceLayer({ version: 1, projects: [], commons })).toEqual([
      { origin: "casefile.yaml", commons },
    ]);
  });
});

describe("resolveWorkspace on examples/demo-repo", async () => {
  const workspace = await loadWorkspace(DEMO_ROOT);
  const { cases, errors } = resolveWorkspace(workspace, { commitFor: () => null });
  const tc3 = cases.find((c) => c.id === "TC-0003");

  it("resolves every case into the single project", () => {
    expect(errors).toEqual([]);
    expect(cases.map((c) => c.id).sort()).toEqual([...DEMO_EXPECTED.caseIds]);
    expect(new Set(cases.map((c) => c.project))).toEqual(new Set([DEMO_EXPECTED.project]));
  });
  it("resolves TC-0003 through its commons chain with origins", () => {
    const [root, checkout, payments] = DEMO_EXPECTED.tc0003CommonsChain;
    const own = "context/tests/checkout/payments/TC-0003.md";
    expect(tc3).toMatchObject({
      surfaces: ["web"],
      layer: "e2e",
      priority: "P1",
      automation: { eligible: true, status: "manual" },
      labels: { owner_team: "checkout", risk: "payments" },
      data: { base_url: "https://staging.acme.example", card: "4111 1111 1111 1111" },
      preconditions: [
        "The Acme Shop staging environment is reachable",
        "A signed-in customer has at least one item in the cart",
        "The payment provider sandbox is enabled",
        "The customer has a saved card ending in 1111",
      ],
    });
    expect(tc3?.origins).toEqual({
      surfaces: root,
      layer: root,
      priority: payments,
      "automation.eligible": payments,
      "labels.owner_team": checkout,
      "labels.risk": payments,
      "data.base_url": root,
      "data.card": payments,
      "preconditions.0": root,
      "preconditions.1": checkout,
      "preconditions.2": payments,
      "preconditions.3": own,
    });
  });

  it("derives automated only for the cases the oracle names", () => {
    const automated = cases.filter((c) => c.automation.status === "automated").map((c) => c.id);
    expect(automated.sort()).toEqual([...DEMO_EXPECTED.derivedAutomated]);
  });

  it("puts extension layers before the project root", () => {
    const org = extensionLayer("@acme/commons", "1.0.0", {
      priority: "P3",
      labels: { org: "acme" },
    });
    const withOrg = resolveWorkspace(workspace, { commitFor: () => null, extensionLayers: [org] });
    const c = withOrg.cases.find((x) => x.id === "TC-0003");
    expect(c?.priority).toBe("P1");
    expect(c?.origins["labels.org"]).toBe("ext:@acme/commons@1.0.0");
  });

  it("collects resolve errors per case", () => {
    const broken: LoadedWorkspace = {
      ...workspace,
      projects: workspace.projects.map((p) => ({ ...p, commons: new Map() })),
    };
    const result = resolveWorkspace(broken, { commitFor: () => null });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((e) => e.code === "resolve.missing_field")).toBe(true);
  });
});

describe("resolveWorkspace on examples/demo-monorepo", async () => {
  const workspace = await loadWorkspace(DEMO_MONOREPO_ROOT);
  const { cases, errors } = resolveWorkspace(workspace, { commitFor: () => null });
  const byRef = new Map(cases.map((c) => [caseRef(c), c]));

  it("resolves the same id in two projects as two distinct cases", () => {
    expect(errors).toEqual([]);
    expect([...byRef.keys()].sort()).toEqual([...DEMO_MONOREPO_EXPECTED.caseRefs]);
    expect(byRef.get("web/TC-0001")?.title).not.toBe(byRef.get("api/TC-0001")?.title);
  });

  it("inherits workspace commons before the project's, with origins", () => {
    const [workspaceOrigin, webRoot] = DEMO_MONOREPO_EXPECTED.webTc0001CommonsChain;
    const web = byRef.get("web/TC-0001");
    expect(web).toMatchObject({
      project: "web",
      path: "apps/web/context/tests/login/TC-0001.md",
      surfaces: ["web"],
      labels: { owner_team: "storefront" },
      data: { base_url: "https://staging.acme.example" },
      preconditions: ["The Acme staging environment is reachable"],
    });
    expect(web?.origins).toEqual({
      surfaces: webRoot,
      layer: webRoot,
      priority: webRoot,
      "automation.eligible": webRoot,
      "labels.owner_team": webRoot,
      "data.base_url": workspaceOrigin,
      "preconditions.0": workspaceOrigin,
    });
    expect(byRef.get("api/TC-0001")).toMatchObject({
      labels: { owner_team: "platform" },
      data: { base_url: "https://api.staging.acme.example" },
      preconditions: [
        "The Acme staging environment is reachable",
        "The orders service is seeded with the demo catalog",
      ],
      origins: {
        "labels.owner_team": "casefile.yaml",
        "data.base_url": "services/api/context/tests/_common.yaml",
      },
    });
  });

  it("derives automated from each project's own runs", () => {
    const automated = cases.filter((c) => c.automation.status === "automated").map(caseRef);
    expect(automated.sort()).toEqual([...DEMO_MONOREPO_EXPECTED.derivedAutomated]);
  });

  it("never uses another project's runs", () => {
    const [web, api] = workspace.projects;
    if (web === undefined || api === undefined) throw new Error("demo-monorepo has two projects");
    // Give api's case the ref that only web's runs carry: it must stay unproven.
    const apiCase = api.cases[0];
    if (apiCase === undefined) throw new Error("api has a case");
    const swapped: LoadedWorkspace = {
      ...workspace,
      projects: [
        web,
        {
          ...api,
          runs: [],
          cases: [
            {
              ...apiCase,
              file: {
                ...apiCase.file,
                automation: {
                  status: "in_progress",
                  ref: "login.spec.ts::signs in with valid credentials",
                },
              },
            },
          ],
        },
      ],
    };
    const result = resolveWorkspace(swapped, { commitFor: () => null });
    const api1 = result.cases.find((c) => caseRef(c) === "api/TC-0001");
    expect(api1?.automation.status).toBe("in_progress");
  });

  it("puts extension layers before workspace commons", () => {
    const org = extensionLayer("@acme/commons", "1.0.0", {
      labels: { owner_team: "org", org: "acme" },
    });
    const result = resolveWorkspace(workspace, { commitFor: () => null, extensionLayers: [org] });
    const api = result.cases.find((c) => caseRef(c) === "api/TC-0001");
    expect(api?.labels).toMatchObject({ owner_team: "platform", org: "acme" });
    expect(api?.origins["labels.org"]).toBe("ext:@acme/commons@1.0.0");
  });
});
