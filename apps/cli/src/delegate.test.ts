import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DELEGATED_ENV } from "@casefile/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { planDelegation, type Reexec, reexec } from "./delegate.js";

const RUNNING = "0.0.0"; // apps/cli/package.json

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "casefile-delegate-"));
  await put("casefile.yaml", "version: 1\nprojects: []\n");
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(tmp, path)), { recursive: true });
  await writeFile(join(tmp, path), text);
};

const pin = (version: string) =>
  put(
    ".casefile/package.json",
    JSON.stringify({ private: true, dependencies: { casefile: version } }),
  );

/** A stand-in for an installed casefile: it records its argv and guard, then exits 7. */
async function install(version: string, bin: unknown = { casefile: "./bin.js" }) {
  const dir = ".casefile/node_modules/casefile";
  await put(
    `${dir}/package.json`,
    JSON.stringify({ name: "casefile", version, type: "module", bin }),
  );
  await put(
    `${dir}/bin.js`,
    `import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_OUT, JSON.stringify({ argv: process.argv.slice(2), guard: process.env.${DELEGATED_ENV} ?? null }));
process.exitCode = 7;`,
  );
}

/** Runs the CLI with a counting re-exec instead of a real one. */
async function cli(argv: string[], env: Record<string, string> = {}) {
  const calls: Parameters<Reexec>[] = [];
  const result = await run(argv, {
    cwd: tmp,
    env,
    reexec: (plan, args) => {
      calls.push([plan, args]);
      return 7;
    },
  });
  return { result, calls };
}

describe("delegation to the pinned casefile", () => {
  it("runs itself when the pinned version is the running one", async () => {
    await pin(RUNNING);
    await install(RUNNING);
    const { result, calls } = await cli(["validate", "--json"]);
    expect(calls).toEqual([]);
    expect(JSON.parse(result.stdout)).toHaveProperty("ok");
  });

  it("re-executes a different installed version once, with the same arguments", async () => {
    await pin("0.4.1");
    await install("0.4.1");
    const argv = ["query", "state = active", "--json"];
    const { result, calls } = await cli(argv);
    expect(result).toEqual({ code: 7, stdout: "", stderr: "" });
    expect(calls).toEqual([
      [
        {
          kind: "delegate",
          bin: join(tmp, ".casefile/node_modules/casefile/bin.js"),
          version: "0.4.1",
        },
        argv,
      ],
    ]);
  });

  it("never re-executes when the loop guard is set", async () => {
    await pin("0.4.1");
    await install("0.4.1");
    const { calls } = await cli(["validate"], { [DELEGATED_ENV]: "0.4.1" });
    expect(calls).toEqual([]);
  });

  it("fails with the install command when the pin is not installed", async () => {
    await pin("0.4.1");
    const { result, calls } = await cli(["validate"]);
    expect(calls).toEqual([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "error  toolchain.not_installed  .casefile/package.json [dependencies.casefile]  casefile is not installed in .casefile/node_modules; this is casefile 0.0.0",
    );
    expect(result.stderr).toContain("hint: npm install --prefix .casefile --ignore-scripts");
    const json = await cli(["validate", "--json"]);
    expect(JSON.parse(json.result.stdout).errors[0].code).toBe("toolchain.not_installed");
  });

  it("never delegates init, nor outside a workspace or without a pin", async () => {
    await pin("0.4.1");
    await install("0.4.1");
    expect((await cli(["init"])).calls).toEqual([]);
    expect(await planDelegation(["validate"], tmpdir(), {}, RUNNING)).toEqual({ kind: "self" });
    await put(".casefile/package.json", JSON.stringify({ dependencies: {} }));
    expect(await planDelegation(["validate"], tmp, {}, RUNNING)).toEqual({ kind: "self" });
  });

  it("locates the workspace from --cwd", async () => {
    await pin("0.4.1");
    await install("0.4.1");
    expect(await planDelegation(["validate", "--cwd", tmp], tmpdir(), {}, RUNNING)).toMatchObject({
      kind: "delegate",
    });
  });

  it("fails when the installed package has no usable bin", async () => {
    await pin("0.4.1");
    for (const bin of [null, { other: "./x.js" }, "../../escape.js"]) {
      await install("0.4.1", bin);
      expect(await planDelegation(["validate"], tmp, {}, RUNNING)).toMatchObject({
        kind: "fail",
        errors: [
          {
            code: "toolchain.not_installed",
            message: "the installed casefile 0.4.1 declares no `bin` to run",
          },
        ],
      });
    }
    await install("0.4.1", "./bin.js");
    expect(await planDelegation(["validate"], tmp, {}, RUNNING)).toMatchObject({
      kind: "delegate",
    });
    await put(".casefile/node_modules/casefile/package.json", "{");
    // Unparseable: no version is installed, so the pin is not installed.
    expect(await planDelegation(["validate"], tmp, {}, RUNNING)).toMatchObject({ kind: "fail" });
  });
});

describe("reexec", () => {
  it("runs the installed bin with Node, the same arguments and the guard, and returns its exit code", async () => {
    await install("0.4.1");
    const out = join(tmp, "out.json");
    process.env.FAKE_OUT = out;
    try {
      const code = reexec(
        {
          kind: "delegate",
          bin: join(tmp, ".casefile/node_modules/casefile/bin.js"),
          version: "0.4.1",
        },
        ["resolve", "TC-0003", "--json"],
      );
      expect(code).toBe(7);
      expect(JSON.parse(await readFile(out, "utf8"))).toEqual({
        argv: ["resolve", "TC-0003", "--json"],
        guard: "0.4.1",
      });
    } finally {
      delete process.env.FAKE_OUT;
    }
  });

  it("returns 1 when the bin cannot run", () => {
    const code = reexec({ kind: "delegate", bin: join(tmp, "missing.js"), version: "0.4.1" }, []);
    expect(code).toBe(1);
  });
});
