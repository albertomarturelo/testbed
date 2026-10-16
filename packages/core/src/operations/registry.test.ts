import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ok } from "../errors.js";
import { defineOperation, type Operation } from "./operation.js";
import { createRegistry } from "./registry.js";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-ops-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const exists = (path: string) =>
  stat(join(root, path)).then(
    () => true,
    () => false,
  );

/** Writes whatever paths it is given; the registry decides what is allowed. */
const writeFiles = defineOperation({
  name: "write-files",
  input: z.strictObject({ paths: z.array(z.string()), dirs: z.array(z.string()).default([]) }),
  output: z.strictObject({ written: z.number() }),
  actor: ["agent"],
  writes: ["context/tests/**", "casefile.yaml"],
  spec: "specs/write-files.md",
  subject: "paths",
  async run({ paths, dirs }, context) {
    for (const dir of dirs) await context.mkdir(dir);
    for (const path of paths) await context.writeText(path, `${path}\n`);
    return ok({ written: paths.length });
  },
});

function registryWith(...operations: Operation[]) {
  const registry = createRegistry();
  for (const operation of operations) expect(registry.register(operation)).toEqual(ok(undefined));
  return registry;
}

describe("register", () => {
  it("lists operations by name", () => {
    const other = defineOperation({ ...writeFiles, name: "another" });
    const registry = registryWith(writeFiles, other);
    expect(registry.list().map((o) => o.name)).toEqual(["another", "write-files"]);
    expect(registry.get("write-files")).toBe(writeFiles);
    expect(registry.get("nope")).toBeUndefined();
  });

  it("refuses a duplicate name", () => {
    const registry = registryWith(writeFiles);
    const result = registry.register(writeFiles);
    expect(result.ok || result.errors.map((e) => e.code)).toEqual(["operation.duplicate"]);
  });

  it("reports every problem of an invalid definition", () => {
    const broken = {
      name: "Not A Slug",
      input: {},
      output: {},
      actor: ["robot"],
      writes: "context/**",
      spec: "",
      subject: "missing",
    } as unknown as Operation;
    const result = createRegistry().register(broken);
    expect(result.ok || result.errors.map((e) => e.message)).toEqual([
      "name 'Not A Slug' is not a slug",
      "'Not A Slug' has no run()",
      "'Not A Slug' has no input schema",
      "'Not A Slug' has no output schema",
      "'Not A Slug' declares unknown actor 'robot'",
      "'Not A Slug' declares no writes list",
      "'Not A Slug' declares no spec",
    ]);
  });

  it("refuses an empty actor list and a subject that is not an input field", () => {
    const result = createRegistry().register(
      defineOperation({ ...writeFiles, actor: [], subject: "nope" }),
    );
    expect(result.ok || result.errors.map((e) => e.message)).toEqual([
      "'write-files' declares no actor",
      "'write-files' names subject 'nope', which is not an input field",
    ]);
  });

  it.each([[null], ["write-files"], [42]])(
    "refuses %j as a definition without throwing",
    (value) => {
      const result = createRegistry().register(value as unknown as Operation);
      expect(result.ok || result.errors.map((e) => e.code)).toEqual([
        "operation.invalid_definition",
      ]);
    },
  );

  it("freezes the declaration", () => {
    expect(Object.isFrozen(writeFiles)).toBe(true);
    expect(Object.isFrozen(writeFiles.writes)).toBe(true);
  });
});

describe("invoke", () => {
  it("runs an allowed write and validates the output", async () => {
    const registry = registryWith(writeFiles);
    const result = await registry.invoke(
      "write-files",
      { paths: ["context/tests/a/TC-0001.md", "casefile.yaml"], dirs: ["context/tests/.runs"] },
      { root, actor: "agent" },
    );
    expect(result).toEqual(ok({ written: 2 }));
    expect(await readFile(join(root, "context/tests/a/TC-0001.md"), "utf8")).toBe(
      "context/tests/a/TC-0001.md\n",
    );
    expect(await exists("context/tests/.runs")).toBe(true);
  });

  it("refuses a write outside `writes` and stops the operation", async () => {
    const registry = registryWith(writeFiles);
    const result = await registry.invoke(
      "write-files",
      { paths: ["context/releases/policy.yaml", "context/tests/later.md"] },
      { root, actor: "agent" },
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "write.not_allowed",
          path: "context/releases/policy.yaml",
          message: "context/releases/policy.yaml is outside this operation's writes",
        },
      ],
    });
    expect(await exists("context/releases/policy.yaml")).toBe(false);
    expect(await exists("context/tests/later.md")).toBe(false);
  });

  it("refuses a directory no allowed file could live in", async () => {
    const registry = registryWith(writeFiles);
    const result = await registry.invoke(
      "write-files",
      { paths: [], dirs: ["context/releases"] },
      { root, actor: "agent" },
    );
    expect(result.ok || result.errors[0]).toMatchObject({
      code: "write.not_allowed",
      path: "context/releases",
    });
  });

  it.each([["../outside.md"], ["/etc/passwd"], ["context/tests/../../../outside.md"], ["."]])(
    "refuses %s as a path outside the workspace",
    async (path) => {
      const registry = registryWith(writeFiles);
      const result = await registry.invoke(
        "write-files",
        { paths: [path] },
        { root, actor: "agent" },
      );
      expect(result.ok || result.errors[0]?.code).toBe("path.outside_workspace");
    },
  );

  it("normalizes paths before matching", async () => {
    const registry = registryWith(writeFiles);
    const result = await registry.invoke(
      "write-files",
      { paths: ["./context//tests/a/../b.md"] },
      { root, actor: "agent" },
    );
    expect(result).toEqual(ok({ written: 1 }));
    expect(await exists("context/tests/b.md")).toBe(true);
  });

  it("returns error values for an unknown operation and a disallowed actor", async () => {
    const registry = registryWith(writeFiles);
    const unknown = await registry.invoke("nope", {}, { root, actor: "agent" });
    expect(unknown.ok || unknown.errors.map((e) => e.code)).toEqual(["operation.unknown"]);
    const human = await registry.invoke("write-files", { paths: [] }, { root, actor: "human" });
    expect(human.ok || human.errors[0]).toMatchObject({
      code: "operation.actor_not_allowed",
      message: "'write-files' may be invoked by agent, not human",
    });
  });

  it("reports invalid input per field", async () => {
    const registry = registryWith(writeFiles);
    const result = await registry.invoke(
      "write-files",
      { paths: "x", extra: 1 },
      { root, actor: "agent" },
    );
    expect(result.ok || result.errors.map((e) => [e.code, e.field ?? null])).toEqual([
      ["operation.invalid_input", "paths"],
      ["operation.invalid_input", null],
    ]);
  });

  it("reports invalid output", async () => {
    const lying = defineOperation({
      ...writeFiles,
      name: "lying",
      async run() {
        return ok({ written: "two" } as unknown as { written: number });
      },
    });
    const result = await registryWith(lying).invoke(
      "lying",
      { paths: [] },
      { root, actor: "agent" },
    );
    expect(result.ok || result.errors[0]).toMatchObject({
      code: "operation.invalid_output",
      field: "written",
    });
  });

  it("passes through the operation's own error values", async () => {
    const failing = defineOperation({
      ...writeFiles,
      name: "failing",
      async run() {
        return { ok: false, errors: [{ code: "project.exists", message: "already there" }] };
      },
    });
    const result = await registryWith(failing).invoke(
      "failing",
      { paths: [] },
      { root, actor: "agent" },
    );
    expect(result).toEqual({
      ok: false,
      errors: [{ code: "project.exists", message: "already there" }],
    });
  });

  it("turns an unexpected throw into operation.failed", async () => {
    const throwing = defineOperation({
      ...writeFiles,
      name: "throwing",
      async run() {
        throw new Error("boom");
      },
    });
    const result = await registryWith(throwing).invoke(
      "throwing",
      { paths: [] },
      { root, actor: "agent" },
    );
    expect(result.ok || result.errors[0]).toEqual({
      code: "operation.failed",
      message: "'throwing' failed: boom",
    });
  });

  it("gives the operation read access inside the workspace only", async () => {
    const reader = defineOperation({
      name: "reader",
      input: z.strictObject({ path: z.string() }),
      output: z.strictObject({ text: z.string().nullable(), exists: z.boolean() }),
      actor: ["human", "agent", "ci"],
      writes: [],
      spec: "specs/reader.md",
      async run({ path }, context) {
        return ok({ text: await context.readText(path), exists: await context.exists(path) });
      },
    });
    const registry = registryWith(writeFiles, reader);
    await registry.invoke("write-files", { paths: ["casefile.yaml"] }, { root, actor: "agent" });
    expect(
      await registry.invoke("reader", { path: "casefile.yaml" }, { root, actor: "ci" }),
    ).toEqual(ok({ text: "casefile.yaml\n", exists: true }));
    expect(await registry.invoke("reader", { path: "missing.md" }, { root, actor: "ci" })).toEqual(
      ok({ text: null, exists: false }),
    );
    const outside = await registry.invoke("reader", { path: "../x" }, { root, actor: "ci" });
    expect(outside.ok || outside.errors[0]?.code).toBe("path.outside_workspace");
  });

  it("fails even when the operation swallows a refused write", async () => {
    const sneaky = defineOperation({
      ...writeFiles,
      name: "sneaky",
      async run(_input, context) {
        try {
          await context.writeText("context/releases/policy.yaml", "x");
        } catch {
          // ignore and pretend all went well
        }
        return ok({ written: 0 });
      },
    });
    const result = await registryWith(sneaky).invoke(
      "sneaky",
      { paths: [] },
      { root, actor: "agent" },
    );
    expect(result.ok || result.errors.map((e) => [e.code, e.path])).toEqual([
      ["write.not_allowed", "context/releases/policy.yaml"],
    ]);
    expect(await exists("context/releases/policy.yaml")).toBe(false);
  });

  it("fails when the operation throws a PathRefused of its own", async () => {
    const { PathRefused } = await import("./context.js");
    const own = defineOperation({
      ...writeFiles,
      name: "own-refusal",
      async run() {
        throw new PathRefused("write.not_allowed", "x.md", "nope");
      },
    });
    const result = await registryWith(own).invoke(
      "own-refusal",
      { paths: [] },
      { root, actor: "agent" },
    );
    expect(result.ok || result.errors).toEqual([
      { code: "write.not_allowed", path: "x.md", message: "nope" },
    ]);
  });

  it("is not transactional: files written before a refusal stay", async () => {
    const result = await registryWith(writeFiles).invoke(
      "write-files",
      { paths: ["context/tests/first.md", "context/releases/policy.yaml"] },
      { root, actor: "agent" },
    );
    expect(result.ok).toBe(false);
    expect(await exists("context/tests/first.md")).toBe(true);
  });

  it("turns a throwing schema into operation.failed", async () => {
    const badSchema = {
      safeParse() {
        throw new Error("schema exploded");
      },
    } as unknown as z.ZodType;
    const broken = defineOperation({ ...writeFiles, name: "bad-schema", input: badSchema });
    const result = await registryWith(broken).invoke("bad-schema", {}, { root, actor: "agent" });
    expect(result.ok || result.errors[0]).toEqual({
      code: "operation.failed",
      message: "'bad-schema' failed: schema exploded",
    });
  });

  it("refuses exists() outside the workspace instead of answering false", async () => {
    const probe = defineOperation({
      name: "probe",
      input: z.strictObject({ path: z.string() }),
      output: z.boolean(),
      actor: ["ci"],
      writes: [],
      spec: "specs/probe.md",
      async run({ path }, context) {
        return ok(await context.exists(path));
      },
    });
    const result = await registryWith(probe).invoke(
      "probe",
      { path: "../x" },
      { root, actor: "ci" },
    );
    expect(result.ok || result.errors[0]?.code).toBe("path.outside_workspace");
  });
});
