import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEMO_ROOT } from "../demo.fixture.js";
import { AGENT_AUTHOR } from "../git/trailers.js";
import { milestoneCloseOperation } from "./milestone-close.js";
import { milestoneListOperation } from "./milestone-list.js";
import { milestoneReportOperation } from "./milestone-report.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";
import { runOperation } from "./run.js";

const registry = createRegistry();
registry.register(milestoneReportOperation);
registry.register(milestoneCloseOperation);
registry.register(runOperation);
registry.register(milestoneListOperation);

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

  it("returns the same evidence as data for a page (#166)", async () => {
    const result = await report();
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { report: document } = result.value as { report: Record<string, unknown> };
    expect(document).toMatchObject({
      slug: "web-1.2.0",
      title: "Web 1.2.0",
      closed: null,
      totals: { in_scope: 5, executed: 5, passed: 3, failed: 2 },
    });
    expect((document.gates as { name: string; verdict: string }[])[0]).toMatchObject({
      name: "smoke",
      verdict: "red",
    });
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
    expect(reported.value).toMatchObject({
      state: "closed",
      evidence: frozen,
      report: { closed: { by: "lead@acme.example" }, note: NOTE },
    });
    expect(await read(EVIDENCE)).toBe(frozen);
  });

  it("reads a closed milestone's report from the frozen file, not from the files now", async () => {
    await close({ note: NOTE });
    // A case retired after the close leaves the active scope; the evidence keeps it.
    const tc = "context/tests/catalog/search/TC-0007.md";
    const text = await read(tc);
    if (text === null) throw new Error(`demo case missing: ${tc}`);
    await writeFile(join(root, tc), text.replace("state: active", "state: retired"));
    const reported = await report();
    if (!reported.ok) throw new Error(JSON.stringify(reported.errors));
    const value = reported.value as { report: { totals: { in_scope: number } } };
    expect(value.report.totals.in_scope).toBe(5);

    await writeFile(join(root, EVIDENCE), "edited by hand\n");
    const edited = await report();
    if (!edited.ok) throw new Error(JSON.stringify(edited.errors));
    expect(edited.value).toMatchObject({ evidence: "edited by hand\n" });
    expect(edited.value).not.toHaveProperty("report");
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

describe("milestone list (#166)", () => {
  const list = (input: Record<string, unknown> = {}) =>
    registry.invoke("milestone-list", input, { root, actor: "human" });
  const opened = (slug: string, extra: string) =>
    writeFile(
      join(root, `context/milestones/${slug}.yaml`),
      `title: ${slug}\nstate: open\n${extra}`,
    );

  it("lists open milestones first, by due date, with progress and red gates", async () => {
    await opened("sprint-2", "due: 2026-12-01\n");
    await opened("sprint-1", "due: 2026-11-20\nscope: priority = P0\n");
    const result = await list();
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { milestones } = result.value as {
      milestones: { slug: string; state: string; totals: unknown; red_gates: string[] }[];
    };
    expect(milestones.map((m) => m.slug)).toEqual(["sprint-1", "sprint-2", "web-1.2.0"]);
    expect(milestones[0]?.totals).toEqual({
      in_scope: 1,
      executed: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      not_run: 1,
    });
    expect(milestones[2]).toMatchObject({
      project: "web",
      title: "Web 1.2.0",
      state: "open",
      release: "web-1.2.0",
      due: null,
      closed: null,
      path: MILESTONE,
      totals: { in_scope: 5, executed: 5, passed: 3 },
    });
    expect(milestones[2]?.red_gates).toContain("smoke");
  });

  it("puts closed ones last with the frozen totals, and lists only open ones on request", async () => {
    await opened("sprint-1", "");
    await close({ note: NOTE });
    const all = await list();
    if (!all.ok) throw new Error(JSON.stringify(all.errors));
    const { milestones } = all.value as {
      milestones: { slug: string; state: string; closed: unknown; totals: unknown }[];
    };
    expect(milestones.map((m) => [m.slug, m.state])).toEqual([
      ["sprint-1", "open"],
      ["web-1.2.0", "closed"],
    ]);
    // Two closed: the latest closed first, whatever their slugs or due dates.
    await writeFile(
      join(root, "context/milestones/a-old.yaml"),
      "title: Old\nstate: closed\ndue: 2099-01-01\nclosed:\n  at: 2020-01-01T00:00:00Z\n  by: lead@acme.example\n  change: 3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44\n",
    );
    const sorted = await list();
    if (!sorted.ok) throw new Error(JSON.stringify(sorted.errors));
    expect(
      (sorted.value as { milestones: { slug: string }[] }).milestones.map((m) => m.slug),
    ).toEqual(["sprint-1", "web-1.2.0", "a-old"]);
    expect(milestones[1]).toMatchObject({
      closed: { by: "lead@acme.example" },
      totals: { in_scope: 5, executed: 5 },
    });
    const onlyOpen = await list({ open: true });
    if (!onlyOpen.ok) throw new Error(JSON.stringify(onlyOpen.errors));
    expect(
      (onlyOpen.value as { milestones: { slug: string }[] }).milestones.map((m) => m.slug),
    ).toEqual(["sprint-1"]);
  });

  it("keeps a milestone whose progress cannot be read, without totals", async () => {
    await opened("broken", "scope: priority =\n");
    const result = await list();
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { milestones } = result.value as { milestones: { slug: string; totals: unknown }[] };
    expect(milestones.find((m) => m.slug === "broken")?.totals).toBeNull();
  });

  it("refuses an unknown project", async () => {
    expect(errorCodes(await list({ project: "nope" }))).toEqual(["project.unknown"]);
  });
});
