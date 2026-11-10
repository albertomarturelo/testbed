import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { planUi, runUi } from "./ui.js";

/** The running CLI's version: a release bumps it (ADR release-process). */
const RUNNING = (
  JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "casefile-ui-"));
  await put("casefile.yaml", "version: 1\nprojects: []\n");
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const put = async (path: string, text: string) => {
  await mkdir(dirname(join(tmp, path)), { recursive: true });
  await writeFile(join(tmp, path), text);
};

const WEB = ".casefile/node_modules/@casefile/web";

/** A stand-in for an installed viewer: it records its argv, then exits 3. */
async function installViewer(version: string, bin: unknown = { "casefile-web": "./bin.js" }) {
  await put(
    `${WEB}/package.json`,
    JSON.stringify({ name: "@casefile/web", version, type: "module", bin }),
  );
  await put(
    `${WEB}/bin.js`,
    `import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_OUT, JSON.stringify(process.argv.slice(2)));
process.exitCode = 3;`,
  );
}

/** Runs the CLI with a recording runner instead of a real child process. */
async function cli(argv: string[], cwd = tmp) {
  const calls: { bin: string; args: readonly string[] }[] = [];
  const result = await run(argv, {
    cwd,
    env: {},
    runUi: async (bin, args) => {
      calls.push({ bin, args });
      return 3;
    },
  });
  return { result, calls };
}

describe("casefile ui", () => {
  it("runs the installed viewer for the workspace, with the port", async () => {
    await installViewer(RUNNING);
    await mkdir(join(tmp, "apps/web"), { recursive: true });
    const { result, calls } = await cli(["ui", "--port", "5000", "--cwd", "apps/web"]);
    expect(calls).toEqual([
      { bin: join(tmp, WEB, "bin.js"), args: ["--cwd", tmp, "--port", "5000"] },
    ]);
    expect(result).toEqual({ code: 3, stdout: "", stderr: "" });

    const plain = await cli(["ui"]);
    expect(plain.calls[0]?.args).toEqual(["--cwd", tmp]);
  });

  it("says ui.not_installed with both fixes when the viewer is missing", async () => {
    const { result, calls } = await cli(["ui", "--json"]);
    expect(calls).toEqual([]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).errors).toEqual([
      {
        code: "ui.not_installed",
        path: ".casefile/node_modules/@casefile/web/package.json",
        message: "the viewer (@casefile/web) is not installed in .casefile/node_modules",
        hint: expect.stringMatching(
          new RegExp(
            `--save-exact @casefile/web@${RUNNING}; without the npm registry.*casefile-toolchain-${RUNNING}\\.tgz`,
          ),
        ),
      },
    ]);
    const text = await cli(["ui"]);
    expect(text.result.stderr).toContain("ui.not_installed");
    expect(text.result.stderr).toContain("hint: npm install --prefix .casefile");
  });

  it("refuses a viewer of another version, or one without its bin", async () => {
    await installViewer("0.0.1");
    expect(await planUi(tmp, RUNNING)).toMatchObject({
      kind: "fail",
      error: {
        code: "ui.not_installed",
        message: `the installed viewer is @casefile/web 0.0.1, but this is casefile ${RUNNING}: they are released together`,
      },
    });
    await installViewer(RUNNING, { other: "./bin.js" });
    expect(await planUi(tmp, RUNNING)).toMatchObject({
      kind: "fail",
      error: { message: "the installed @casefile/web declares no `casefile-web` to run" },
    });
    // A bin outside its own package is not the package's.
    await installViewer(RUNNING, { "casefile-web": "../../../../escape.js" });
    expect((await planUi(tmp, RUNNING)).kind).toBe("fail");
  });

  it("needs a workspace, and rejects flags it does not have", async () => {
    const outside = await mkdtemp(join(tmpdir(), "casefile-ui-none-"));
    try {
      const { result } = await cli(["ui", "--json"], outside);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout).errors[0].code).toBe("workspace.missing");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    const bad = await cli(["ui", "--open", "--json"]);
    expect(JSON.parse(bad.result.stdout).errors[0]).toMatchObject({
      code: "cli.usage",
      message: expect.stringContaining("usage: casefile ui [--port <n>]"),
    });
  });

  it("prints its help without a viewer, and is listed in the usage", async () => {
    const help = await cli(["ui", "--help"]);
    expect(help.result.stdout).toContain("Usage: casefile ui [--port <n>]");
    expect((await cli([])).result.stdout).toMatch(/\n {2}ui\s+Opens the viewer/);
  });

  it("runUi runs the bin with this Node and returns its exit code", async () => {
    await installViewer(RUNNING);
    const out = join(tmp, "out.json");
    const before = process.env.FAKE_OUT;
    process.env.FAKE_OUT = out;
    try {
      const code = await runUi(join(tmp, WEB, "bin.js"), ["--cwd", tmp, "--port", "0"]);
      expect(code).toBe(3);
      expect(JSON.parse(await readFile(out, "utf8"))).toEqual(["--cwd", tmp, "--port", "0"]);
    } finally {
      if (before === undefined) delete process.env.FAKE_OUT;
      else process.env.FAKE_OUT = before;
    }
  });
});
