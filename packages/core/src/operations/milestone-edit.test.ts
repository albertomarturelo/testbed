import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEMO_ROOT } from "../demo.fixture.js";
import { AGENT_AUTHOR } from "../git/trailers.js";
import { milestoneCloseOperation } from "./milestone-close.js";
import { milestoneEditOperation } from "./milestone-edit.js";
import { milestoneReportOperation } from "./milestone-report.js";
import type { Actor } from "./operation.js";
import { createRegistry } from "./registry.js";

const registry = createRegistry();
registry.register(milestoneEditOperation);
registry.register(milestoneReportOperation);
registry.register(milestoneCloseOperation);

const MILESTONE = "context/milestones/web-1.2.0.yaml";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-milestone-edit-"));
  await cp(DEMO_ROOT, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const edit = (input: Record<string, unknown>, actor: Actor = "agent") =>
  registry.invoke(
    "milestone-edit",
    {
      identity: "qa@acme.example",
      via: "cli:milestone-edit",
      slug: "web-1.2.0",
      ...(actor === "agent" ? { agent: "claude-code" } : {}),
      ...input,
    },
    { root, actor },
  );
const read = () => readFile(join(root, MILESTONE), "utf8");

type Edited = {
  path: string;
  changed: string[];
  change: string | null;
  commit: { author?: string; message: string; files: string[] } | null;
  next: string[];
};
const value = (result: Awaited<ReturnType<typeof edit>>): Edited => {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value as Edited;
};

describe("milestone edit (#210, ADR milestones-group-executions §2)", () => {
  it("changes only the given fields and records the edit", async () => {
    const edited = value(await edit({ scope: "feature = login", due: "2026-12-15" }));
    expect(edited.changed).toEqual(["due", "scope"]);
    expect(edited.path).toBe(MILESTONE);
    const text = await read();
    expect(parse(text)).toEqual({
      title: "Web 1.2.0",
      state: "open",
      due: "2026-12-15",
      release: "web-1.2.0",
      scope: "feature = login",
      edited: [
        {
          at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
          by: "qa@acme.example",
          change: edited.change,
          fields: ["due", "scope"],
        },
      ],
    });
    // Keys in the order open writes them; new ones in place, `edited` last.
    expect(Object.keys(parse(text))).toEqual([
      "title",
      "state",
      "due",
      "release",
      "scope",
      "edited",
    ]);
  });

  it("returns the commit with open's trailers, as the agent", async () => {
    const edited = value(await edit({ title: "Web 1.2.0 RC" }));
    expect(edited.commit).toEqual({
      author: AGENT_AUTHOR,
      message: `test(web): edit milestone web-1.2.0\n\nRequested-by: qa@acme.example\nAgent: claude-code\nCasefile-Change: ${edited.change}\n`,
      files: [MILESTONE],
    });
    expect(parse(await read()).title).toBe("Web 1.2.0 RC");
  });

  it("commits as the human, without Agent:", async () => {
    const edited = value(await edit({ release: "web-1.2.1" }, "human"));
    expect(edited.commit).toEqual({
      message: `test(web): edit milestone web-1.2.0\n\nRequested-by: qa@acme.example\nCasefile-Change: ${edited.change}\n`,
      files: [MILESTONE],
    });
    expect(parse(await read()).release).toBe("web-1.2.1");
    expect(await edit({ release: "x", agent: "claude-code" }, "human")).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.agent_not_allowed" }],
    });
  });

  it("removes due and release given as empty, and appends each edit", async () => {
    value(await edit({ due: "2026-12-15" }));
    const cleared = value(await edit({ due: "", release: "" }));
    expect(cleared.changed).toEqual(["due", "release"]);
    const file = parse(await read());
    expect(file).not.toHaveProperty("due");
    expect(file).not.toHaveProperty("release");
    expect(file.edited.map((e: { fields: string[] }) => e.fields)).toEqual([
      ["due"],
      ["due", "release"],
    ]);
  });

  it("keeps the comments and opened stamp the file had", async () => {
    await writeFile(
      join(root, MILESTONE),
      "# the release QA certifies\ntitle: Web 1.2.0\nstate: open\nopened:\n  at: '2026-10-10T09:00:00Z'\n  by: qa@acme.example\n  change: 3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44\n",
    );
    value(await edit({ scope: "priority = P0" }));
    const text = await read();
    expect(text.startsWith("# the release QA certifies\n")).toBe(true);
    expect(Object.keys(parse(text))).toEqual(["title", "state", "scope", "opened", "edited"]);
    expect(parse(text).opened.change).toBe("3b0e8f4a-6c1d-4f7e-9a52-0d9e2c1b7a44");
  });

  it("writes nothing and says so when every given field already has that value", async () => {
    const before = await read();
    const result = value(await edit({ title: "Web 1.2.0", release: "web-1.2.0", due: "" }));
    expect(result).toMatchObject({ changed: [], change: null, commit: null });
    expect(result.next[0]).toContain("Nothing to change");
    expect(await read()).toBe(before);
  });

  it("refuses a call with no field, a bad scope, a bad date and an empty title", async () => {
    const before = await read();
    expect(await edit({})).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.edit_empty" }],
    });
    expect(await edit({ scope: "priority =" })).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.invalid_scope", field: "scope" }],
    });
    expect(await edit({ due: "next week" })).toMatchObject({
      ok: false,
      errors: [{ code: "operation.invalid_input", field: "due" }],
    });
    expect((await edit({ title: "" })).ok).toBe(false);
    expect((await edit({ scope: "" })).ok).toBe(false);
    expect(await read()).toBe(before);
  });

  it("refuses an unknown milestone and a closed one", async () => {
    expect(await edit({ slug: "web-9", title: "X" })).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.unknown", field: "slug" }],
    });
    await writeFile(join(root, MILESTONE), "title: Web 1.2.0\nstate: closed\n");
    expect(await edit({ title: "X" })).toMatchObject({
      ok: false,
      errors: [{ code: "milestone.closed", field: "slug" }],
    });
    expect(await read()).toBe("title: Web 1.2.0\nstate: closed\n");
  });

  it("shows each edit in the report and in the evidence close freezes (#213)", async () => {
    const first = value(await edit({ scope: "feature = login", due: "2026-12-15" }));
    value(await edit({ title: "Web 1.2.0 RC" }, "human"));
    const at = (parse(await read()) as { edited: { at: string }[] }).edited.map((e) => e.at);
    expect(first.changed).toEqual(["due", "scope"]);
    const rows = [
      `| Edited | ${at[0]} by qa@acme.example: due, scope |`,
      `| Edited | ${at[1]} by qa@acme.example: title |`,
    ];
    const report = await registry.invoke(
      "milestone-report",
      { slug: "web-1.2.0" },
      { root, actor: "human" },
    );
    if (!report.ok) throw new Error(JSON.stringify(report.errors));
    const shown = report.value as { evidence: string; report: { edited: unknown[] } };
    expect(shown.evidence).toContain(`| Opened | — |\n${rows.join("\n")}\n| Closed |`);
    expect(shown.report.edited).toEqual([
      { at: at[0], by: "qa@acme.example", fields: ["due", "scope"] },
      { at: at[1], by: "qa@acme.example", fields: ["title"] },
    ]);

    const closed = await registry.invoke(
      "milestone-close",
      { identity: "lead@acme.example", via: "cli:milestone-close", slug: "web-1.2.0", note: "x" },
      { root, actor: "human" },
    );
    if (!closed.ok) throw new Error(JSON.stringify(closed.errors));
    const frozen = await readFile(join(root, "context/milestones/web-1.2.0/evidence.md"), "utf8");
    expect(frozen).toContain(rows.join("\n"));
  });

  it("is refused for CI", async () => {
    expect(await edit({ title: "X" }, "ci")).toMatchObject({
      ok: false,
      errors: [{ code: "operation.actor_not_allowed" }],
    });
  });
});
