import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_EXPECTED, DEMO_ROOT } from "../demo.fixture.js";
import { loadRepo } from "./repo.js";

describe("loadRepo on examples/demo-repo", async () => {
  const repo = await loadRepo(DEMO_ROOT);

  it("loads without errors", () => {
    expect(repo.errors).toEqual([]);
    expect(repo.config).toEqual({ version: 1 });
  });

  it("loads every case with repo-relative POSIX paths", () => {
    expect(repo.cases.map((c) => c.file.id).sort()).toEqual([...DEMO_EXPECTED.caseIds]);
    expect(repo.cases.find((c) => c.file.id === "TC-0003")?.path).toBe(
      "context/tests/checkout/payments/TC-0003.md",
    );
  });

  it("loads the commons and the run events", () => {
    for (const path of DEMO_EXPECTED.tc0003CommonsChain) expect(repo.commons.has(path)).toBe(true);
    expect(new Set(repo.runs.map((r) => r.run_id)).size).toBe(DEMO_EXPECTED.runFiles);
  });
});

describe("loadRepo on broken repos", () => {
  let root = "";
  const put = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("reports a missing casefile.yaml and tolerates a missing context/tests", async () => {
    root = await mkdtemp(join(tmpdir(), "casefile-"));
    const repo = await loadRepo(root);
    expect(repo.errors).toEqual([expect.objectContaining({ code: "config.missing" })]);
    expect(repo.cases).toEqual([]);
  });

  it("collects errors per file and still loads the rest", async () => {
    root = await mkdtemp(join(tmpdir(), "casefile-"));
    await put("casefile.yaml", "version: 2\n");
    await put("context/tests/_common.yaml", "layer: [\n");
    await put("context/tests/a/TC-0001.md", "no frontmatter\n");
    await put("context/tests/.runs/r.jsonl", "{}\n");
    await put("context/tests/a/_common.yaml", "layer: e2e\n");
    await put("context/tests/.inbox/abc/in-1.yaml", "ignored: [\n");
    await put("context/tests/a/notes.md", "ignored\n");
    const repo = await loadRepo(root);
    expect(repo.config).toBeNull();
    expect([...repo.commons.keys()]).toEqual(["context/tests/a/_common.yaml"]);
    expect(new Set(repo.errors.map((e) => `${e.path} ${e.code}`))).toEqual(
      new Set([
        "casefile.yaml schema.invalid",
        "context/tests/_common.yaml yaml.invalid",
        "context/tests/a/TC-0001.md frontmatter.missing",
        "context/tests/.runs/r.jsonl schema.invalid",
      ]),
    );
  });
});
