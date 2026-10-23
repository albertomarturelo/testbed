import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MONOREPO_ROOT } from "../demo.fixture.js";
import { AGENT_AUTHOR, runCommitMessage } from "../git/trailers.js";
import { NOTE_MAX } from "../schema/index.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";
import { runOperation } from "./run.js";
import { runsOperation } from "./runs.js";
import { CORE_SPECS_DIR } from "./spec.js";
import { validateOperation } from "./validate.js";

const registry = createRegistry();
registry.register(runOperation);
registry.register(runsOperation);
registry.register(validateOperation);

const RUNS = "apps/web/context/tests/.runs";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-run-"));
  await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

type Recorded = {
  ref: string;
  run: string;
  path: string;
  appended: boolean;
  event: Record<string, unknown>;
  commit?: { author?: string; message: string; files: string[] };
  next: string[];
};

/** What the CLI host fills in for a human (ADR cli-generic-host §3). */
const human = { identity: "qa@acme.example", project: "web" };
const record = (input: Record<string, unknown>, actor: Actor = "human") =>
  registry.invoke("run", { ...human, ref: "TC-0002", ...input }, { root, actor });
const recorded = async (input: Record<string, unknown>, actor: Actor = "human") => {
  const result = await record(input, actor);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value as Recorded;
};
const runFile = (run: string) => readFile(join(root, RUNS, `${run}.jsonl`), "utf8");
const today = () => new Date().toISOString().slice(0, 10);

/** The call and the line of `casefile spec run`'s example. */
async function specExample() {
  const spec = await readFile(join(CORE_SPECS_DIR, "run.md"), "utf8");
  const call = /^casefile run ([\s\S]*?)^```$/m.exec(spec)?.[1] ?? "";
  const line = /^```json (manual-\S+)\.jsonl\n([\s\S]*?)^```$/m.exec(spec);
  const flag = (name: string) => new RegExp(`--${name} (\\S+)`).exec(call)?.[1];
  const note = /--note "([^"]*)"/.exec(call)?.[1];
  if (line === null || note === undefined) throw new Error("run.md lost its example");
  return {
    input: { ref: call.split(/\s/)[0], status: flag("status"), env: flag("env"), note },
    run: line[1] as string,
    line: line[2] as string,
  };
}

describe("run", () => {
  it("appends the line `casefile spec run` shows and returns the commit", async () => {
    const example = await specExample();
    const value = await recorded({ ...example.input, project: undefined });
    const run = `manual-${today()}`;
    expect(value).toMatchObject({
      ref: "web/TC-0002",
      run,
      path: `${RUNS}/${run}.jsonl`,
      appended: true,
    });
    const written = await runFile(run);
    const at = value.event.at as string;
    expect(Date.now() - Date.parse(at)).toBeLessThan(60_000);
    expect(written).toBe(
      example.line.replaceAll(example.run, run).replace(/"at":"[^"]+"/, `"at":"${at}"`),
    );
    expect(value.commit).toEqual({
      message: runCommitMessage("run(login): record TC-0002 as failed", {
        run,
        executor: "human:qa@acme.example",
      }),
      files: [value.path],
    });
    expect(value.next[0]).toContain("as yourself");

    const runs = await registry.invoke("runs", { ref: "web/TC-0002" }, { root, actor: "human" });
    expect(runs).toMatchObject({
      ok: true,
      value: { runs: [{ run_id: run, status: "failed", path: value.path }] },
    });
    expect(await registry.invoke("validate", {}, { root, actor: "human" })).toMatchObject({
      ok: true,
    });
  });

  it("records an agent as agent:<name>, authored by casefile-agent", async () => {
    const value = await recorded(
      {
        identity: undefined,
        agent: "claude-code",
        status: "passed",
        run: "rc-2.1",
        build: "web-2.1.0",
      },
      "agent",
    );
    expect(value.event).toMatchObject({ executor: "agent:claude-code", run_id: "rc-2.1" });
    expect(value.commit).toEqual({
      author: AGENT_AUTHOR,
      message: runCommitMessage("run(login): record TC-0002 as passed", {
        run: "rc-2.1",
        executor: "agent:claude-code",
      }),
      files: [value.path],
    });
  });

  it("never writes automation_ref, even for a case that has one", async () => {
    const value = await recorded({ ref: "TC-0001", status: "passed" });
    expect(value.event).not.toHaveProperty("automation_ref");
    expect(await runFile(value.run)).not.toContain("automation_ref");
  });

  it("cuts a long note to NOTE_MAX, the last character …", async () => {
    const value = await recorded({ status: "failed", note: "x".repeat(NOTE_MAX + 50) });
    const note = value.event.note as string;
    expect(note).toHaveLength(NOTE_MAX);
    expect(note.endsWith("…")).toBe(true);
  });

  it("appends after the existing lines, which stay byte for byte", async () => {
    const before = `{"broken": \n`;
    await writeFile(join(root, RUNS, "rc-1.jsonl"), before);
    await recorded({ status: "blocked", run: "rc-1" });
    const written = await runFile("rc-1");
    expect(written.startsWith(before)).toBe(true);
    expect(written.split("\n")).toHaveLength(3);
  });

  it("writes nothing for a retry, but always records a new execution", async () => {
    const first = await recorded({ status: "passed", run: "rc-1" });
    const retry = await recorded({ status: "passed", run: "rc-1" });
    expect(retry).toMatchObject({
      appended: false,
      next: [expect.stringContaining("Nothing new")],
    });
    expect(retry.commit).toBeUndefined();
    expect(await runFile("rc-1")).toBe(`${JSON.stringify(first.event)}\n`);

    await recorded({ status: "failed", run: "rc-1" });
    expect(await recorded({ status: "passed", run: "rc-1" })).toMatchObject({ appended: true });
    const statuses = (await runFile("rc-1"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { status: string }).status);
    expect(statuses).toEqual(["passed", "failed", "passed"]);
  });
});

describe("run refuses, writing nothing", () => {
  const refused = async (input: Record<string, unknown>, code: string, actor: Actor = "human") => {
    const before = await readdir(join(root, RUNS)).catch(() => []);
    const result = await record(input, actor);
    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ code })] });
    expect(await readdir(join(root, RUNS)).catch(() => [])).toEqual(before);
  };

  it("a status that is not a result, or a field the event does not take", async () => {
    await refused({ status: "not_run" }, "operation.invalid_input");
    await refused(
      { status: "passed", automationRef: "login.spec.ts::x" },
      "operation.invalid_input",
    );
    await refused({ status: "passed", run: "../escape" }, "operation.invalid_input");
  });

  it("an executor that does not add up", async () => {
    await refused({ status: "passed" }, "run.agent_required", "agent");
    await refused({ status: "passed", agent: "claude-code" }, "run.agent_not_allowed");
    await refused({ status: "passed", identity: undefined }, "identity.missing");
    await refused({ status: "passed" }, "operation.actor_not_allowed", "ci");
  });

  it("an unknown or ambiguous case", async () => {
    await refused({ status: "passed", ref: "TC-0099" }, "case.unknown");
    await refused({ status: "passed", ref: "TC-0001", project: undefined }, "case.ambiguous");
  });
});
