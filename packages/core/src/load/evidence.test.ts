import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Evidence } from "../schema/index.js";
import { findNamedEvidence } from "./evidence.js";

const SHA = "a".repeat(64);
const RUNS = "apps/web/context/tests/.runs";
const stored = `${RUNS}/r1/TC-0001/aaaaaaaa-shot.png`;

let root = "";

/** One run event of `run`, carrying `evidence`, as a line of `<run>.jsonl`. */
const line = (run: string, evidence: Evidence[]) =>
  `${JSON.stringify({
    run_id: run,
    case_id: "TC-0001",
    status: "failed",
    executor: "human:qa@acme.example",
    at: "2026-11-20T10:00:00Z",
    evidence,
  })}\n`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-named-evidence-"));
  await writeFile(
    join(root, "casefile.yaml"),
    "version: 1\nprojects:\n  - name: web\n    path: ./apps/web/\n  - name: api\n    path: apps/api\nevidence:\n  max_file_mb: 2\n",
  );
  await mkdir(join(root, RUNS), { recursive: true });
  await mkdir(join(root, "apps/api/context/tests/.runs"), { recursive: true });
  await writeFile(
    join(root, RUNS, "r1.jsonl"),
    line("r1", [
      { kind: "image", ref: stored, sha256: SHA, label: "The banner" },
      { kind: "link", ref: "https://example.com/bug/1" },
      { kind: "attachment", ref: `${RUNS}/r1/TC-0001/trace.zip` },
      // Names a file in another project's directory: not this project's.
      { kind: "file", ref: "apps/api/context/tests/.runs/r1/TC-0001/x.log", sha256: SHA },
    ]),
  );
  // Another run file naming r1's ref does not count: only r1.jsonl is read for it.
  await writeFile(
    join(root, RUNS, "r2.jsonl"),
    line("r2", [{ kind: "image", ref: `${RUNS}/r1/TC-0001/other.png`, sha256: SHA }]),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("findNamedEvidence (ADR run-evidence-files §7)", () => {
  it("answers the entry the ref's own run file names, with the evidence config", async () => {
    expect(await findNamedEvidence(root, stored)).toEqual({
      entry: { kind: "image", ref: stored, sha256: SHA, label: "The banner" },
      config: { max_file_mb: 2 },
    });
  });

  it("answers null for links, ingest references, other projects' paths and unnamed refs", async () => {
    for (const ref of [
      "https://example.com/bug/1",
      `${RUNS}/r1/TC-0001/trace.zip`,
      "apps/api/context/tests/.runs/r1/TC-0001/x.log",
      `${RUNS}/r1/TC-0001/other.png`,
      `${RUNS}/nope/TC-0001/x.png`,
      `${RUNS}/r1/TC-0001/../../../../../../etc/passwd`,
      "casefile.yaml",
    ]) {
      expect([ref, await findNamedEvidence(root, ref)]).toEqual([ref, null]);
    }
  });

  it("answers null outside a workspace", async () => {
    expect(await findNamedEvidence(join(root, "apps"), stored)).toBeNull();
  });
});
