import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CasefileError, TOOLCHAIN_DIR, WEB_BIN, WEB_PACKAGE } from "@casefile/core";
import { installedBin } from "./delegate.js";

/** What `casefile ui` does: run the installed viewer, or say why it cannot. */
export type UiPlan =
  | { kind: "run"; bin: string }
  | { kind: "fail"; error: CasefileError & { hint: string } };

/** Runs the viewer's bin with these arguments until it exits; returns its exit code. */
export type RunUi = (bin: string, args: readonly string[]) => Promise<number>;

/**
 * Filesystem adapter (ADR casefile-ui-command §3–5): the viewer is the
 * `@casefile/web` installed in the workspace's toolchain directory, at the
 * running CLI's version. The CLI never imports it; it only finds its bin.
 */
export async function planUi(root: string, running: string): Promise<UiPlan> {
  const dir = join(root, TOOLCHAIN_DIR, "node_modules", WEB_PACKAGE);
  const fail = (message: string): UiPlan => ({
    kind: "fail",
    error: {
      code: "ui.not_installed",
      path: `${TOOLCHAIN_DIR}/node_modules/${WEB_PACKAGE}/package.json`,
      message,
      hint: `npm install --prefix ${TOOLCHAIN_DIR} --ignore-scripts --save-exact ${WEB_PACKAGE}@${running}; without the npm registry, pin ${WEB_PACKAGE} ${running} in ${TOOLCHAIN_DIR}/package.json and unpack the release's casefile-toolchain-${running}.tgz into ${TOOLCHAIN_DIR}`,
    },
  });

  const text = await readFile(join(dir, "package.json"), "utf8").catch(() => null);
  if (text === null) {
    return fail(`the viewer (${WEB_PACKAGE}) is not installed in ${TOOLCHAIN_DIR}/node_modules`);
  }
  let version: unknown;
  try {
    version = (JSON.parse(text) as { version?: unknown }).version;
  } catch {
    version = undefined;
  }
  if (version !== running) {
    return fail(
      `the installed viewer is ${WEB_PACKAGE} ${String(version)}, but this is casefile ${running}: they are released together`,
    );
  }
  const bin = await installedBin(dir, WEB_BIN);
  if (bin === null) return fail(`the installed ${WEB_PACKAGE} declares no \`${WEB_BIN}\` to run`);
  return { kind: "run", bin };
}

/**
 * Runs the viewer with this process's Node, stdio and environment, and passes
 * on the signals that stop it, so Ctrl-C or a `kill` of casefile stops the
 * server too.
 */
export const runUi: RunUi = (bin, args) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: "inherit" });
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    const finish = (code: number) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      done(code);
    };
    child.on("error", (error) => {
      process.stderr.write(`casefile: could not run ${bin}: ${error.message}\n`);
      finish(1);
    });
    // Stopped by a signal: the usual 128 + n is not worth a table; it did not fail.
    child.on("exit", (code, signal) => finish(code ?? (signal === null ? 1 : 0)));
  });
