import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MONOREPO_ROOT } from "../demo.fixture.js";
import { AGENT_AUTHOR, commitMessage } from "../git/trailers.js";
import { parseCaseFile } from "../load/parse.js";
import type { TestCaseFile } from "../schema/index.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";
import { reviewOperation } from "./review.js";
import { CORE_SPECS_DIR } from "./spec.js";
import { validateOperation } from "./validate.js";

const registry = createRegistry();
registry.register(reviewOperation);
registry.register(validateOperation);

const LOGIN = "apps/web/context/tests/login";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The change of `web/TC-0001`'s only `history` entry in the demo monorepo. */
const TC1_CHANGE = "4c1a2b3d-1e2f-4a5b-8c6d-7e8f9a0b1c01";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-review-"));
  await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

type Reviewed = {
  ref: string;
  path: string;
  change: string;
  state: string;
  changed: string[];
  events: string[];
  commit: { author?: string; message: string; files: string[] };
  next: string[];
};

/** What the CLI host fills in for an agent (ADR cli-generic-host §3). */
const agentCall = {
  project: "web",
  identity: "qa@acme.example",
  via: "cli:review",
  agent: "claude-code",
};
const review = (input: Record<string, unknown>, actor: Actor = "agent") =>
  registry.invoke("review", { ...agentCall, ref: "TC-0001", ...input }, { root, actor });
const reviewed = async (input: Record<string, unknown>, actor: Actor = "agent") => {
  const result = await review(input, actor);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value as Reviewed;
};
const asHuman = { agent: undefined, via: "ui:review" };
const text = (id = "TC-0001") => readFile(join(root, LOGIN, `${id}.md`), "utf8");
const caseFile = async (id = "TC-0001"): Promise<TestCaseFile> => {
  const parsed = parseCaseFile(`${id}.md`, await text(id));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value.file;
};

/** The call and both files of `casefile spec review`'s example; it starts from cover's. */
async function specExample() {
  const spec = await readFile(join(CORE_SPECS_DIR, "review.md"), "utf8");
  const cover = await readFile(join(CORE_SPECS_DIR, "cover.md"), "utf8");
  const fileIn = (doc: string) => /^```markdown TC-0003\.md\n([\s\S]*?)^```$/m.exec(doc)?.[1];
  const call = /^CASEFILE_ACTOR=agent casefile review ([\s\S]*?)^```$/m.exec(spec)?.[1] ?? "";
  const flag = (name: string) => new RegExp(`--${name} (\\S+)`).exec(call)?.[1];
  const set = /--set '(\{[\s\S]*?\})'/.exec(call)?.[1];
  const [before, after] = [fileIn(cover), fileIn(spec)];
  if (set === undefined || before === undefined || after === undefined) {
    throw new Error("review.md lost its example");
  }
  return {
    input: {
      ref: call.split(/\s/)[0],
      to: flag("to"),
      agent: flag("agent"),
      base: flag("base"),
      set: JSON.parse(set) as unknown,
    },
    before,
    after,
  };
}

describe("review", () => {
  it("writes the file `casefile spec review` shows and returns the commit", async () => {
    const example = await specExample();
    await writeFile(join(root, LOGIN, "TC-0003.md"), example.before);
    const value = await reviewed({ ...example.input, project: undefined });
    expect(value).toMatchObject({
      ref: "web/TC-0003",
      path: `${LOGIN}/TC-0003.md`,
      state: "active",
      changed: ["steps"],
      events: ["updated", "reviewed"],
    });
    expect(value.change).toMatch(UUID);

    const written = await text("TC-0003");
    const at = /at: "([^"]+)"\n {4}by: \S+\n {4}via: cli:review/.exec(written)?.[1] as string;
    expect(Date.now() - Date.parse(at)).toBeLessThan(60_000);
    expect(written).toBe(
      example.after
        .replaceAll('"2026-10-19T09:30:00Z"', `"${at}"`)
        .replaceAll("5e1c7a2b-8d3f-4a6e-9b0c-2f4d6e8a1c3b", value.change),
    );
    expect(value.commit).toEqual({
      author: AGENT_AUTHOR,
      message: commitMessage("review(login): edit and approve TC-0003", {
        requestedBy: "qa@acme.example",
        agent: "claude-code",
        change: value.change,
      }),
      files: [`${LOGIN}/TC-0003.md`],
    });
    expect(value.next[0]).toContain("-- <path>");
    expect(await registry.invoke("validate", {}, { root, actor: "agent" })).toMatchObject({
      ok: true,
    });
  });

  it("lets a human approve as themself: via ui, no author, no Agent: trailer", async () => {
    const value = await reviewed(
      { ...asHuman, to: "retired", identity: "lead@acme.example" },
      "human",
    );
    expect(value.commit).toEqual({
      message: `review(login): retire TC-0001\n\nRequested-by: lead@acme.example\nCasefile-Change: ${value.change}\n`,
      files: [value.path],
    });
    expect(value.next[0]).toContain("as yourself");
    expect((await caseFile()).history.at(-1)).toMatchObject({
      by: "lead@acme.example",
      via: "ui:review",
      event: "retired",
      change: value.change,
    });
  });

  it("names requestedBy for an agent working on someone else's request, with inbox and note", async () => {
    const value = await reviewed({
      requestedBy: "lead@acme.example",
      inbox: "7f3c",
      note: "Support ticket 12",
      set: { title: "Sign in with a valid email and password" },
    });
    expect(value.commit.message).toBe(
      commitMessage("review(login): edit TC-0001", {
        requestedBy: "lead@acme.example",
        inbox: "7f3c",
        agent: "claude-code",
        change: value.change,
      }),
    );
    const file = await caseFile();
    expect(file.history.at(-1)).toEqual({
      at: expect.any(String),
      by: "lead@acme.example",
      via: "cli:review",
      change: value.change,
      inbox: "7f3c",
      event: "updated",
      note: "Support ticket 12",
    });
    expect(file.state).toBe("active");
  });

  it("keeps the body byte for byte, CRLF included, unless notes replace it", async () => {
    const original = await text();
    const body = "\r\nWritten on Windows.\r\n\r\n- keep this\r\n";
    await writeFile(join(root, LOGIN, "TC-0001.md"), `${original.split("---\n\n")[0]}---\n${body}`);
    await reviewed({ set: { priority: "P1" } });
    expect((await text()).endsWith(`---\n${body}`)).toBe(true);

    const notes = await reviewed({ set: { notes: "  New notes.\n" } });
    expect(notes.changed).toEqual(["notes"]);
    expect((await text()).endsWith("---\n\nNew notes.\n")).toBe(true);
    await reviewed({ set: { notes: null } });
    expect((await text()).endsWith("---\n")).toBe(true);
  });

  it("merges automation per key; null unlinks the test", async () => {
    const value = await reviewed({ set: { automation: { status: "candidate", ref: null } } });
    expect(value.changed).toEqual(["automation"]);
    expect((await caseFile()).automation).toEqual({ status: "candidate" });
    await reviewed({ set: { automation: { status: null } } });
    expect((await caseFile()).automation).toBeUndefined();
  });

  it("removes a field set to null, so it is inherited again", async () => {
    await reviewed({ set: { priority: "P0" } });
    expect((await caseFile()).priority).toBe("P0");
    const value = await reviewed({ set: { priority: null, steps: (await caseFile()).steps } });
    expect(value.changed).toEqual(["priority"]);
    expect((await caseFile()).priority).toBeUndefined();
  });

  it("walks every transition with its event and verb", async () => {
    await writeFile(
      join(root, LOGIN, "TC-0001.md"),
      (await text()).replace("state: active", "state: draft"),
    );
    const walk: [string, string, string][] = [
      ["in_review", "review_requested", "request review of"],
      ["draft", "state_changed", "send back"],
      ["retired", "retired", "reject"],
      ["draft", "state_changed", "reopen"],
      ["active", "reviewed", "approve"],
      ["retired", "retired", "retire"],
    ];
    for (const [to, event, verb] of walk) {
      const value = await reviewed({ to });
      expect(value).toMatchObject({ state: to, events: [event], changed: [] });
      expect(value.commit.message.split("\n")[0]).toBe(`review(login): ${verb} TC-0001`);
    }
    await writeFile(
      join(root, LOGIN, "TC-0001.md"),
      (await text()).replace("state: retired", "state: in_review"),
    );
    expect(await reviewed({ to: "active" })).toMatchObject({ events: ["reviewed"] });
    await writeFile(
      join(root, LOGIN, "TC-0001.md"),
      (await text()).replace("state: active", "state: in_review"),
    );
    expect(await reviewed({ to: "retired" })).toMatchObject({ events: ["retired"] });
    expect((await caseFile()).history).toHaveLength(9);
  });
});

describe("review refuses, writing nothing", () => {
  const refused = async (
    input: Record<string, unknown>,
    code: string,
    field?: string,
    actor: Actor = "agent",
  ) => {
    const before = await text();
    const result = await review(input, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code, ...(field === undefined ? {} : { field }) }),
      );
    }
    expect(await text()).toBe(before);
  };

  it("automation.status automated or flaky: derived from runs, never written", async () => {
    for (const status of ["automated", "flaky"]) {
      await refused(
        { set: { automation: { status } } },
        "operation.invalid_input",
        "set.automation.status",
      );
    }
  });

  it("neither set nor to, or a field that is not the case's", async () => {
    await refused({}, "operation.invalid_input", "set");
    await refused({ set: { nope: 1 } }, "operation.invalid_input");
    await refused({ set: { title: "Line one\nline two" } }, "operation.invalid_input");
  });

  it("a field that is casefile's to write", async () => {
    for (const key of [
      "id",
      "feature",
      "state",
      "origin",
      "history",
      "mirror",
      "duplicates_checked_against",
    ]) {
      await refused({ set: { [key]: null } }, "review.not_editable", `set.${key}`);
    }
  });

  it("nothing to change, or a retry", async () => {
    await refused({ set: { title: "Sign in with valid credentials" } }, "review.no_change", "set");
    const first = await reviewed({ base: TC1_CHANGE, set: { priority: "P1" } });
    await refused({ set: { priority: "P1" } }, "review.no_change");
    await refused({ base: TC1_CHANGE, set: { priority: "P0" } }, "review.stale", "base");
    expect(await reviewed({ base: first.change, set: { priority: "P0" } })).toMatchObject({
      changed: ["priority"],
    });
  });

  it("a move the case cannot make, including to its own state", async () => {
    await refused({ to: "active" }, "review.invalid_transition", "to");
    await refused({ to: "draft" }, "review.invalid_transition", "to");
    await refused({ to: "in_review", set: { priority: "P1" } }, "review.invalid_transition");
  });

  it("a writer that does not add up", async () => {
    await refused({ agent: undefined, to: "retired" }, "review.agent_required", "agent");
    await refused({ identity: undefined, to: "retired" }, "identity.missing");
    const human = { ...asHuman, to: "retired" };
    await refused({ ...human, agent: "claude-code" }, "review.agent_not_allowed", "agent", "human");
    await refused(
      { ...human, requestedBy: "x@acme.example" },
      "review.requested_by_not_allowed",
      "requestedBy",
      "human",
    );
    await refused({ ...human, identity: undefined }, "identity.missing", "identity", "human");
    await refused({ to: "retired" }, "operation.actor_not_allowed", undefined, "ci");
  });

  it("a title the feature has, an undeclared label, a field left set nowhere", async () => {
    // `web/TC-0002` is "Reject a wrong password"; case and spacing do not matter.
    await refused(
      { set: { title: "reject a  WRONG password" } },
      "review.duplicate_title",
      "set.title",
    );
    await refused({ set: { labels: { nope: "x" } } }, "label.undeclared", "set.labels.nope");
    await writeFile(
      join(root, "apps/web/context/tests/_common.yaml"),
      "surfaces: [web]\nlayer: e2e\nautomation:\n  eligible: true\n",
    );
    await writeFile(
      join(root, LOGIN, "TC-0001.md"),
      (await text()).replace("origin: agent", "origin: agent\npriority: P1"),
    );
    await refused({ set: { priority: null } }, "resolve.missing_field", "set.priority");
  });

  it("an unknown or ambiguous case", async () => {
    await refused({ ref: "TC-0099", to: "retired" }, "case.unknown");
    await refused({ project: undefined, to: "retired" }, "case.ambiguous");
  });
});
