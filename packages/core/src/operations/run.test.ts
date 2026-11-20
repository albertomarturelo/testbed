import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MONOREPO_ROOT } from "../demo.fixture.js";
import { AGENT_AUTHOR, runCommitMessage } from "../git/trailers.js";
import { NOTE_MAX } from "../schema/index.js";
import { sha256Hex } from "./evidence.js";
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
/** Where the files to attach are: outside the workspace, like a QA's Downloads. */
let shots = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-run-"));
  shots = await mkdtemp(join(tmpdir(), "casefile-shots-"));
  await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(shots, { recursive: true, force: true });
});

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
      message: runCommitMessage("test(login): record TC-0002 as failed", {
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
      message: runCommitMessage("test(login): record TC-0002 as passed", {
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

describe("run attaches evidence (ADR run-evidence-files)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const shot = async (name: string, bytes: Uint8Array | string = PNG) => {
    await writeFile(join(shots, name), bytes);
    return join(shots, name);
  };
  const stored = (run: string, bytes: Uint8Array | string, name: string) =>
    `${RUNS}/${run}/TC-0002/${sha256Hex(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).slice(0, 8)}-${name}`;

  it("copies and hashes a file, keeps a link, and returns both in one commit", async () => {
    const file = await shot("Shot 1.PNG");
    const value = await recorded({
      status: "failed",
      run: "rc-1",
      evidence: [file],
      link: ["https://example.com/bug/1"],
    });
    const ref = stored("rc-1", PNG, "shot-1.png");
    expect(value.event.evidence).toEqual([
      { kind: "image", ref, sha256: sha256Hex(PNG) },
      { kind: "link", ref: "https://example.com/bug/1" },
    ]);
    expect(new Uint8Array(await readFile(join(root, ref)))).toEqual(PNG);
    expect(value.commit?.files).toEqual([value.path, ref]);
    expect(value.next[0]).toContain("commit.files");
    expect(JSON.parse(await runFile("rc-1"))).toEqual(value.event);
    expect(await registry.invoke("validate", {}, { root, actor: "human" })).toMatchObject({
      ok: true,
    });
  });

  it("resolves a relative path against the host's cwd", async () => {
    await shot("console.log", "TypeError: x is undefined\n");
    const value = await recorded({
      status: "failed",
      run: "rc-1",
      cwd: shots,
      evidence: ["console.log"],
    });
    expect(value.event.evidence).toEqual([
      expect.objectContaining({
        kind: "file",
        ref: stored("rc-1", "TypeError: x is undefined\n", "console.log"),
      }),
    ]);
  });

  it("takes labels through attach, after evidence and link, in order", async () => {
    const video = await shot("checkout.webm", "webm");
    const value = await recorded({
      status: "failed",
      run: "rc-1",
      evidence: [await shot("a.png")],
      link: ["https://example.com/a"],
      attach: [
        { url: "https://ci.example/build/9", label: "CI build" },
        { file: video, label: "The checkout freezing" },
      ],
    });
    expect(value.event.evidence).toEqual([
      expect.objectContaining({ kind: "image" }),
      { kind: "link", ref: "https://example.com/a" },
      { kind: "link", ref: "https://ci.example/build/9", label: "CI build" },
      {
        kind: "video",
        ref: stored("rc-1", "webm", "checkout.webm"),
        sha256: sha256Hex(new TextEncoder().encode("webm")),
        label: "The checkout freezing",
      },
    ]);
    expect(value.commit?.files).toHaveLength(3);
  });

  it("writes the same content under the same name once", async () => {
    const file = await shot("shot.png");
    const first = await recorded({ status: "failed", run: "rc-1", evidence: [file, file] });
    const ref = stored("rc-1", PNG, "shot.png");
    expect(first.event.evidence).toEqual([
      expect.objectContaining({ ref }),
      expect.objectContaining({ ref }),
    ]);
    expect(first.commit?.files).toEqual([first.path, ref]);
    // Executed again, same screenshot: the stored file is reused, not rewritten.
    const again = await recorded({ status: "blocked", run: "rc-1", evidence: [file] });
    expect(again.event.evidence).toEqual([expect.objectContaining({ ref })]);
    expect(again.commit?.files).toEqual([again.path, ref]);
    expect(await readdir(join(root, RUNS, "rc-1", "TC-0002"))).toEqual([ref.split("/").pop()]);
  });

  it("writes nothing for a retry with the same evidence", async () => {
    const input = { status: "failed", run: "rc-1", evidence: [await shot("shot.png")] };
    const first = await recorded(input);
    const retry = await recorded(input);
    expect(retry).toMatchObject({ appended: false });
    expect(retry.commit).toBeUndefined();
    expect(await runFile("rc-1")).toBe(`${JSON.stringify(first.event)}\n`);
    // Following the hint after a failed first commit also commits the evidence.
    expect(retry.next[0]).toContain(`${first.path} ${first.commit?.files[1]}`);
  });

  it("lets validate report a stored file deleted or edited afterwards", async () => {
    const value = await recorded({
      status: "failed",
      run: "rc-1",
      evidence: [await shot("a.png")],
    });
    const ref = (value.event.evidence as { ref: string }[])[0]?.ref as string;
    await writeFile(join(root, ref), "edited");
    const changed = await registry.invoke("validate", {}, { root, actor: "human" });
    expect(changed.ok || changed.errors.map((e) => e.code)).toEqual(["evidence.changed"]);
    await rm(join(root, ref));
    const missing = await registry.invoke("validate", {}, { root, actor: "human" });
    expect(missing.ok || missing.errors.map((e) => e.code)).toEqual(["evidence.missing"]);
    // Only the selected project's evidence is checked (and hashed).
    expect(
      await registry.invoke("validate", { project: "api" }, { root, actor: "human" }),
    ).toMatchObject({ ok: true });
  });

  it("lets validate report a stored file replaced by a symlink, never following it", async (t) => {
    const source = await shot("a.png");
    const value = await recorded({ status: "failed", run: "rc-1", evidence: [source] });
    const ref = (value.event.evidence as { ref: string }[])[0]?.ref as string;
    await rm(join(root, ref));
    try {
      await symlink(source, join(root, ref));
    } catch {
      t.skip(); // no symlinks here (Windows without developer mode)
    }
    const result = await registry.invoke("validate", {}, { root, actor: "human" });
    expect(result.ok || result.errors.map((e) => [e.code, e.field])).toEqual([
      ["evidence.changed", "evidence.0.ref"],
    ]);
    expect(result.ok || result.errors[0]?.message).toContain("not a regular file");
  });
});

describe("run refuses evidence, writing nothing", () => {
  const refused = async (input: Record<string, unknown>, expected: [string, string][]) => {
    const before = await readdir(join(root, RUNS));
    const result = await record({ status: "failed", run: "rc-1", ...input });
    expect(result.ok || result.errors.map((e) => [e.code, e.field])).toEqual(expected);
    expect(await readdir(join(root, RUNS))).toEqual(before);
  };

  it("a file that is not there, or not a regular file", async () => {
    await refused({ evidence: [join(shots, "gone.png")] }, [["evidence.not_found", "evidence.0"]]);
    await mkdir(join(shots, "folder.png"));
    await refused({ evidence: [join(shots, "folder.png")] }, [
      ["evidence.not_found", "evidence.0"],
    ]);
  });

  it("a type outside the list, and a script type always", async () => {
    await writeFile(join(shots, "a.svg"), "<svg/>");
    await writeFile(join(shots, "a.docx"), "x");
    await refused({ evidence: [join(shots, "a.png"), join(shots, "a.svg")] }, [
      ["evidence.type", "evidence.1"],
    ]);
    await appendFile(join(root, "casefile.yaml"), "evidence:\n  extensions: [docx, svg]\n");
    await refused({ attach: [{ file: join(shots, "a.svg") }] }, [["evidence.type", "attach.0"]]);
    await writeFile(join(shots, "a.png"), "png");
    await refused({ evidence: [join(shots, "a.png")] }, [["evidence.type", "evidence.0"]]);
  });

  it("a file over evidence.max_file_mb, checked before any other file is written", async () => {
    await appendFile(join(root, "casefile.yaml"), "evidence:\n  max_file_mb: 0.001\n");
    await writeFile(join(shots, "small.png"), "x");
    await writeFile(join(shots, "big.png"), "x".repeat(2000));
    await refused({ evidence: [join(shots, "small.png"), join(shots, "big.png")] }, [
      ["evidence.too_large", "evidence.1"],
    ]);
  });

  it("a file over 2 GiB, from its size, without reading it", async () => {
    await writeFile(join(shots, "huge.webm"), "");
    await truncate(join(shots, "huge.webm"), 3 * 1024 ** 3); // sparse: no disk used
    await refused({ evidence: [join(shots, "huge.webm")] }, [["evidence.too_large", "evidence.0"]]);
  });

  it("more than 20 entries, and a link that is not http(s)", async () => {
    const links = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`);
    await refused({ link: links }, [["evidence.too_many", "link.20"]]);
    await refused({ link: ["ftp://example.com/x"] }, [["evidence.link", "link.0"]]);
  });

  it("a stored file with other content under the same name", async () => {
    await writeFile(join(shots, "a.png"), "png");
    const ref = `${RUNS}/rc-1/TC-0002/${sha256Hex(new TextEncoder().encode("png")).slice(0, 8)}-a.png`;
    await recorded({ status: "failed", run: "rc-1", evidence: [join(shots, "a.png")] });
    await writeFile(join(root, ref), "tampered");
    const result = await record({
      status: "passed",
      run: "rc-1",
      evidence: [join(shots, "a.png")],
    });
    expect(result.ok || result.errors.map((e) => e.code)).toEqual(["evidence.conflict"]);
    expect(await readFile(join(root, ref), "utf8")).toBe("tampered");
  });

  it("a label over 120 characters, or an entry with both file and url", async () => {
    await refused({ attach: [{ url: "https://example.com", label: "x".repeat(121) }] }, [
      ["operation.invalid_input", "attach.0.label"],
    ]);
    const both = await record({
      status: "failed",
      attach: [{ file: "a.png", url: "https://x.y" }],
    });
    expect(both.ok || both.errors[0]?.code).toBe("operation.invalid_input");
  });
});
