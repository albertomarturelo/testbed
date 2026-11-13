import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEMO_ROOT } from "../demo.fixture.js";
import { AGENT_AUTHOR } from "../git/trailers.js";
import { milestoneCloseOperation } from "./milestone-close.js";
import { milestoneReportOperation } from "./milestone-report.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";
import { runOperation } from "./run.js";

const registry = createRegistry();
registry.register(milestoneReportOperation);
registry.register(milestoneCloseOperation);
registry.register(runOperation);

const MILESTONE = "context/milestones/web-1.2.0.yaml";
const EVIDENCE = "context/milestones/web-1.2.0/evidence.md";
const NOTE = "Search (TC-0007) fails on staging data only; ACME-412 tracks it.";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-milestone-close-"));
  await cp(DEMO_ROOT, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const report = (slug = "web-1.2.0") =>
  registry.invoke("milestone-report", { slug }, { root, actor: "human" });
const close = (input: Record<string, unknown>, actor: Actor = "agent") =>
  registry.invoke(
    "milestone-close",
    {
      identity: "lead@acme.example",
      via: "cli:milestone-close",
      slug: "web-1.2.0",
      ...(actor === "agent" ? { agent: "claude-code" } : {}),
      ...input,
    },
    { root, actor },
  );
const read = (path: string) => readFile(join(root, path), "utf8").catch(() => null);
const errorCodes = (result: { ok: boolean; errors?: { code: string }[] }) =>
  result.ok ? [] : (result.errors ?? []).map((e) => e.code);

type Closed = {
  evidence: string;
  path: string;
  change: string;
  red_gates: string[];
  commit: { author?: string; message: string; files: string[] };
  next: string[];
};

describe("milestone report", () => {
  it("prints the evidence close would write, and writes nothing", async () => {
    const result = await report();
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const value = result.value as {
      state: string;
      path: string;
      evidence: string;
      red_gates: string[];
    };
    expect(value.state).toBe("open");
    expect(value.path).toBe(EVIDENCE);
    expect(value.evidence).toContain("# Milestone evidence: Web 1.2.0\n");
    expect(value.evidence).toContain("| Closed | not closed: a report, not frozen evidence |");
    expect(value.red_gates).toContain("smoke");
    expect(await read(EVIDENCE)).toBeNull();
  });

  it("refuses a milestone the project does not declare", async () => {
    expect(errorCodes(await report("web-9.9.9"))).toEqual(["milestone.unknown"]);
  });
});

describe("milestone close (ADR milestones-group-executions §2, §4, §5)", () => {
  it("refuses red gates without a note, and writes nothing", async () => {
    const before = await read(MILESTONE);
    const result = await close({});
    expect(errorCodes(result)).toEqual(["milestone.red_gates"]);
    expect(await read(EVIDENCE)).toBeNull();
    expect(await read(MILESTONE)).toBe(before);
  });

  it("writes the evidence and closes the milestone in one commit", async () => {
    await writeFile(join(root, MILESTONE), `# Web release\n${await read(MILESTONE)}`);
    const result = await close({ note: NOTE });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const value = result.value as Closed;
    expect(value.evidence).toBe(EVIDENCE);
    expect(value.red_gates).toContain("smoke");

    const evidence = (await read(EVIDENCE)) ?? "";
    expect(evidence).toContain("| Closed | ");
    expect(evidence).toContain(" by lead@acme.example |");
    expect(evidence).toContain(`## Close note\n\n${NOTE}\n`);

    const text = (await read(MILESTONE)) ?? "";
    expect(text.startsWith("# Web release\n")).toBe(true); // the human's comment survives
    expect(parse(text)).toEqual({
      title: "Web 1.2.0",
      state: "closed",
      release: "web-1.2.0",
      closed: { at: expect.any(String), by: "lead@acme.example", change: value.change },
    });

    expect(value.commit).toEqual({
      author: AGENT_AUTHOR,
      message: `test(web): close milestone web-1.2.0\n\nRequested-by: lead@acme.example\nAgent: claude-code\nCasefile-Change: ${value.change}\nCasefile-Milestone: web-1.2.0\n`,
      files: [EVIDENCE, MILESTONE],
    });
    expect(value.next.at(-1)).toBe(
      `Attach the evidence to the GitHub release: gh release upload web-1.2.0 ${EVIDENCE}`,
    );
  });

  it("closes as the human who signs it, with no agent author", async () => {
    const result = await close({ note: NOTE }, "human");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { commit } = result.value as Closed;
    expect(commit.author).toBeUndefined();
    expect(commit.message).not.toContain("Agent:");
    expect(commit.message).toContain("Casefile-Milestone: web-1.2.0\n");
  });

  it("needs no note when no policy makes a gate red", async () => {
    await rm(join(root, "context/releases/policy.yaml"));
    const result = await close({});
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect((result.value as Closed).red_gates).toEqual([]);
    const evidence = (await read(EVIDENCE)) ?? "";
    expect(evidence).not.toContain("## Gates");
    expect(evidence).not.toContain("## Close note");
  });

  it("freezes the evidence: closing again, recording into it, and report all see it closed", async () => {
    const closed = await close({ note: NOTE });
    expect(closed.ok).toBe(true);
    const frozen = await read(EVIDENCE);

    expect(errorCodes(await close({ note: NOTE }))).toEqual(["milestone.closed"]);
    const run = await registry.invoke(
      "run",
      { identity: "qa@acme.example", ref: "TC-0007", status: "passed", milestone: "web-1.2.0" },
      { root, actor: "human" },
    );
    expect(errorCodes(run)).toEqual(["milestone.closed"]);

    const reported = await report();
    if (!reported.ok) throw new Error(JSON.stringify(reported.errors));
    expect(reported.value).toMatchObject({ state: "closed", evidence: frozen });
    expect(await read(EVIDENCE)).toBe(frozen);
  });

  it("reports a closed milestone whose evidence file is gone", async () => {
    await close({ note: NOTE });
    await rm(join(root, EVIDENCE));
    expect(errorCodes(await report())).toEqual(["milestone.evidence_missing"]);
  });

  it("refuses an unknown milestone and an agent that does not name itself", async () => {
    expect(errorCodes(await close({ slug: "web-9.9.9", note: NOTE }))).toEqual([
      "milestone.unknown",
    ]);
    expect(
      errorCodes(
        await registry.invoke(
          "milestone-close",
          { identity: "lead@acme.example", via: "cli:milestone-close", slug: "web-1.2.0" },
          { root, actor: "agent" },
        ),
      ),
    ).toEqual(["milestone.agent_required"]);
  });
});
