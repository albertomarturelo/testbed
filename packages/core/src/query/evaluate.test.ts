import { describe, expect, it } from "vitest";
import {
  DEMO_EXPECTED,
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  DEMO_ROOT,
} from "../demo.fixture.js";
import { loadWorkspace } from "../load/workspace.js";
import { caseRef, resolveWorkspace } from "../resolve/resolve.js";
import { checkQueryContext, evaluateQuery, type QueryContext, queryCases } from "./evaluate.js";
import { parseQuery } from "./parse.js";

/** A hand-made subject: the evaluator reads any object, not only resolved cases. */
const SUBJECT = {
  id: "TC-0003",
  project: "web",
  feature: "checkout/payments",
  title: "Pay with a 3-D Secure card",
  state: "active",
  priority: "P1",
  surfaces: ["web", "ios"],
  automation: { eligible: true, status: "manual" },
  labels: { smoke: true, risk: "payments", score: 7, version: "1.2", tags: ["fast", "nightly"] },
  steps: [{ do: "Open the cart", expect: "The total is shown" }],
  nothing: null,
};

function matches(text: string, context: QueryContext = {}): boolean {
  const parsed = parseQuery(text);
  if (!parsed.ok) throw new Error(parsed.errors[0]?.message);
  return evaluateQuery(parsed.value, SUBJECT, context);
}

describe("evaluateQuery: equality", () => {
  it.each([
    ["state = active", true],
    ["state = draft", false],
    ["state != draft", true],
    ["state != active", false],
    [`title = "Pay with a 3-D Secure card"`, true],
    ["id = TC-0003", true],
    ["labels.smoke = true", true],
    ["labels.smoke = false", false],
    ["labels.score = 7", true],
    ["labels.score = 7.0", true],
    ["automation.eligible = true", true],
    ["steps.0.do = 'Open the cart'", true],
    ["surfaces.1 = ios", true],
  ])("%s → %s", (text, expected) => {
    expect(matches(text)).toBe(expected);
  });

  it("matches a bare word against a string field by its text", () => {
    expect(matches("labels.version = 1.2")).toBe(true);
    expect(matches("labels.version = 1.20")).toBe(false);
  });

  it("never matches a quoted string against a boolean or number", () => {
    expect(matches(`labels.smoke = "true"`)).toBe(false);
    expect(matches(`labels.score = "7"`)).toBe(false);
  });
});

describe("evaluateQuery: boolean operators", () => {
  it.each([
    ["state = draft OR priority = P1", true],
    ["state = draft OR priority = P0", false],
    ["state = active AND priority = P0", false],
    ["NOT (state = draft OR priority = P0)", true],
    ["state = draft OR state = active AND priority = P1", true],
    ["(state = draft OR state = active) AND priority = P0", false],
  ])("%s → %s", (text, expected) => {
    expect(matches(text)).toBe(expected);
  });
});

describe("evaluateQuery: long chains", () => {
  it("evaluates and collects variables of 20 000-term chains without overflowing", () => {
    const terms = Array.from({ length: 20_000 }, () => "state = active");
    expect(matches(terms.join(" AND "))).toBe(true);
    expect(matches([...terms.map(() => "state = draft"), "priority = P1"].join(" OR "))).toBe(true);
    const parsed = parseQuery(terms.map(() => "x IN release.list").join(" OR "));
    expect(parsed.ok && checkQueryContext(parsed.value, { release: { list: [] } }).ok).toBe(true);
  });
});

describe("evaluateQuery: missing fields and type mismatches", () => {
  it.each([
    ["labels.absent = x", false],
    ["labels.absent != x", true],
    ["nothing = x", false],
    ["labels.smoke.deeper = x", false],
    ["steps.9.do = x", false],
    ["labels.absent < 3", false],
    ["labels.absent IN (x, y)", false],
    ["labels.absent CONTAINS x", false],
    ["NOT labels.absent CONTAINS x", true],
  ])("missing: %s → %s", (text, expected) => {
    expect(matches(text)).toBe(expected);
  });

  it.each([
    ["labels.score = seven", false],
    ["labels.smoke = 1", false],
    ["automation = manual", false],
    ["surfaces = web", false],
    ["labels.score < P1", false],
    ["labels.smoke > false", false],
    ["automation >= 1", false],
    ["labels.score CONTAINS 7", false],
    ["labels.tags CONTAINS 7", false],
  ])("mismatch: %s → %s", (text, expected) => {
    expect(matches(text)).toBe(expected);
  });

  it("does not read inherited object properties", () => {
    expect(matches("labels.constructor = x")).toBe(false);
    expect(matches("state.length = 6")).toBe(false);
    expect(matches("surfaces.length = 2")).toBe(false);
    expect(matches("labels.tags.length >= 0")).toBe(false);
  });
});

describe("evaluateQuery: ordering", () => {
  it.each([
    ["labels.score < 8", true],
    ["labels.score < 7", false],
    ["labels.score <= 7", true],
    ["labels.score > 6.5", true],
    ["labels.score >= 8", false],
    ["priority <= P1", true],
    ["priority < P1", false],
    ["priority > P0", true],
    ["id >= TC-0003", true],
    ["labels.version < 1.3", true],
    [`title > "A"`, true],
  ])("%s → %s", (text, expected) => {
    expect(matches(text)).toBe(expected);
  });
});

describe("evaluateQuery: IN and CONTAINS", () => {
  it.each([
    ["state IN (draft, active)", true],
    ["state IN (draft)", false],
    ["NOT state IN (draft)", true],
    ["labels.score IN (1, 7)", true],
    ["surfaces IN (android, ios)", true],
    ["surfaces IN (android)", false],
    ["surfaces CONTAINS web", true],
    ["surfaces CONTAINS android", false],
    ["labels.tags CONTAINS 'nightly'", true],
    ["title CONTAINS 3-D", true],
    ["title CONTAINS 'secure'", false],
    ["feature CONTAINS checkout/", true],
  ])("%s → %s", (text, expected) => {
    expect(matches(text)).toBe(expected);
  });
});

describe("evaluateQuery: context variables", () => {
  const context: QueryContext = {
    release: {
      changed_features: ["checkout/payments", "auth/login"],
      build: "web-1.2.0+101",
      risk: "payments",
    },
  };

  it("reads list and scalar variables", () => {
    expect(matches("feature IN release.changed_features", context)).toBe(true);
    expect(matches("labels.risk = release.risk", context)).toBe(true);
    expect(matches("release.build = web-1.2.0+101", context)).toBe(true);
    expect(matches("state IN (draft, release.risk)", context)).toBe(false);
    expect(matches("labels.risk IN (draft, release.risk)", context)).toBe(true);
    expect(matches("title CONTAINS release.risk", context)).toBe(false);
  });

  it("compares variable values strictly", () => {
    const typed: QueryContext = { release: { score: 7, scoreText: "7", flag: true } };
    expect(matches("labels.score = release.score", typed)).toBe(true);
    expect(matches("labels.score = release.scoreText", typed)).toBe(false);
    expect(matches("labels.score <= release.score", typed)).toBe(true);
    expect(matches("labels.score CONTAINS release.score", typed)).toBe(false);
    expect(matches("labels.tags CONTAINS release.flag", typed)).toBe(false);
  });

  it("treats a non-list variable after IN as an empty list", () => {
    expect(matches("feature IN release.build", context)).toBe(false);
  });

  it("checks that every variable is defined, with its position", () => {
    const parsed = parseQuery(
      "feature IN release.changed_features OR release.build = x AND release.nope = 1",
    );
    if (!parsed.ok) throw new Error("parses");
    const full: QueryContext = { release: { ...context.release, nope: 0 } };
    expect(checkQueryContext(parsed.value, full)).toEqual({ ok: true, value: parsed.value });
    expect(checkQueryContext(parsed.value, {})).toEqual({
      ok: false,
      errors: [
        {
          code: "query.unknown_variable",
          column: 12,
          message: "context variable `release.changed_features` is not defined",
        },
        {
          code: "query.unknown_variable",
          column: 40,
          message: "context variable `release.build` is not defined",
        },
        {
          code: "query.unknown_variable",
          column: 62,
          message: "context variable `release.nope` is not defined",
        },
      ],
    });
  });
});

describe("queryCases on examples/demo-repo", async () => {
  const { cases } = resolveWorkspace(await loadWorkspace(DEMO_ROOT), { commitFor: () => null });
  const ids = (text: string, context?: QueryContext) => {
    const result = queryCases(text, cases, context);
    if (!result.ok) throw new Error(result.errors[0]?.message);
    return result.value.map((c) => c.id);
  };

  it.each(Object.entries(DEMO_EXPECTED.queries))("%s", (text, expected) => {
    expect(ids(text)).toEqual(expected);
  });

  it("reads a list from the release context", () => {
    const context = { release: { changed_features: ["auth/login"] } };
    expect(ids("feature IN release.changed_features", context)).toEqual(
      ids("feature = auth/login"),
    );
    expect(ids("feature = auth/login").length).toBeGreaterThan(0);
  });

  it("returns parse and context errors instead of cases", () => {
    expect(queryCases("state =", cases)).toMatchObject({
      ok: false,
      errors: [{ code: "query.unexpected_end" }],
    });
    expect(queryCases("feature IN release.changed_features", cases)).toMatchObject({
      ok: false,
      errors: [{ code: "query.unknown_variable", column: 12 }],
    });
  });
});

describe("queryCases on examples/demo-monorepo", async () => {
  const { cases } = resolveWorkspace(await loadWorkspace(DEMO_MONOREPO_ROOT), {
    commitFor: () => null,
  });

  it("filters by project with `project = web`", () => {
    const result = queryCases("project = web", cases);
    if (!result.ok) throw new Error(result.errors[0]?.message);
    const web = DEMO_MONOREPO_EXPECTED.caseRefs.filter((ref) => ref.startsWith("web/"));
    expect(result.value.map(caseRef).sort()).toEqual(web);
    expect(result.value.length).toBeGreaterThan(0);
  });

  it("combines project with other fields", () => {
    const result = queryCases("project != web AND automation.status = automated", cases);
    const expected = DEMO_MONOREPO_EXPECTED.derivedAutomated.filter(
      (ref) => !ref.startsWith("web/"),
    );
    expect(result.ok && result.value.map(caseRef)).toEqual(expected);
  });
});
