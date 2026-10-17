import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEMO_EXPECTED,
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  DEMO_ROOT,
} from "../demo.fixture.js";
import { createRegistry } from "./registry.js";
import { validateOperation } from "./validate.js";

const BROKEN = fileURLToPath(new URL("../../fixtures/broken/", import.meta.url));

const registry = createRegistry();
registry.register(validateOperation);
const validate = (root: string, input: Record<string, unknown> = {}) =>
  registry.invoke("validate", input, { root, actor: "agent" });

describe("validate operation", () => {
  it("succeeds on the demo with counts", async () => {
    expect(await validate(DEMO_ROOT)).toEqual({
      ok: true,
      value: { projects: 1, cases: DEMO_EXPECTED.caseIds.length, warnings: 0, findings: [] },
    });
  });

  it("fails with every finding when one is an error", async () => {
    const result = await validate(join(BROKEN, "label-undeclared"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toEqual([
      "label.undeclared",
      "label.undeclared",
      "label.undeclared",
    ]);
    expect(result.errors[0]).toMatchObject({ severity: "error", path: "casefile.yaml" });
  });

  it("succeeds with warnings only", async () => {
    const result = await validate(join(BROKEN, "toolchain-unpinned"));
    expect(result).toMatchObject({
      ok: true,
      value: { warnings: 1, findings: [{ code: "toolchain.unpinned", severity: "warning" }] },
    });
  });

  it("keeps one project's findings plus the workspace-level ones", async () => {
    const root = join(BROKEN, "levels-per-project");
    const paths = async (input: Record<string, unknown>) => {
      const result = await validate(root, input);
      return result.ok ? [] : result.errors.map((e) => e.path);
    };
    const own = "apps/web/context/tests/_common.yaml";
    expect(await paths({})).toEqual(["casefile.yaml", own]);
    expect(await paths({ project: "web" })).toEqual(["casefile.yaml", own]);
    // `casefile.yaml` lies in no project: every selection keeps its findings.
    expect(await paths({ project: "gone" })).toEqual(["casefile.yaml"]);
  });

  it("counts only the selected project", async () => {
    const web = await validate(DEMO_MONOREPO_ROOT, { project: "web" });
    const all = await validate(DEMO_MONOREPO_ROOT);
    const refs = DEMO_MONOREPO_EXPECTED.caseRefs;
    const webCases = refs.filter((ref) => ref.startsWith("web/")).length;
    expect(web).toMatchObject({ ok: true, value: { projects: 1, cases: webCases } });
    expect(all).toMatchObject({ ok: true, value: { projects: 2, cases: refs.length } });
  });

  it("returns config findings whole when casefile.yaml cannot be read, even with a project", async () => {
    const root = join(BROKEN, "config-yaml-invalid");
    const all = await validate(root);
    const named = await validate(root, { project: "web" });
    expect(all.ok).toBe(false);
    expect(named).toEqual(all);
  });

  it("fails on an unknown project", async () => {
    expect(await validate(DEMO_ROOT, { project: "nope" })).toEqual({
      ok: false,
      errors: [
        {
          code: "project.unknown",
          field: "project",
          message: "no project named 'nope' in casefile.yaml",
        },
      ],
    });
  });
});
