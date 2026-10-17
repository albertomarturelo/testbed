import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  builtinOperations,
  CASEFILE_PACKAGE,
  type CasefileError,
  DELEGATED_ENV,
  findWorkspaceRoot,
  loadToolchain,
  TOOLCHAIN_DIR,
  toolchainDelegation,
} from "@casefile/core";
import { type Command, findCwd, matchCommand, toCommand } from "./args.js";

/** What the invoked casefile does before parsing the command (ADR casefile-toolchain-dir §4). */
export type Plan =
  | { kind: "self" }
  | { kind: "delegate"; bin: string; version: string }
  | { kind: "fail"; errors: CasefileError[] };

/** Re-executes another casefile with the same arguments; returns its exit code. */
export type Reexec = (plan: Extract<Plan, { kind: "delegate" }>, argv: readonly string[]) => number;

/**
 * Filesystem adapter: finds the workspace from `--cwd` and decides with core's
 * `toolchainDelegation`. Never delegates when already delegated (the loop
 * guard), outside a workspace, or for an operation with `root: "cwd"` (`init`
 * must work before anything is installed).
 */
export async function planDelegation(
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  running: string,
): Promise<Plan> {
  if (env[DELEGATED_ENV] !== undefined) return { kind: "self" };
  const builtins = builtinOperations.flatMap((op) => {
    const command = toCommand(op);
    return command.ok ? [command.value] : ([] as Command[]);
  });
  if (matchCommand(builtins, argv)?.command.operation.root === "cwd") return { kind: "self" };

  const located = await findWorkspaceRoot(resolve(cwd, findCwd(argv) ?? "."));
  if (!located.ok) return { kind: "self" };
  const root = located.value;
  const decision = toolchainDelegation(await loadToolchain(root, []), running);
  if (decision.action === "run") return { kind: "self" };
  if (decision.action === "fail") return { kind: "fail", errors: [decision.error] };

  const bin = await installedBin(join(root, TOOLCHAIN_DIR, "node_modules", CASEFILE_PACKAGE));
  if (bin === null) {
    return {
      kind: "fail",
      errors: [
        {
          code: "toolchain.not_installed",
          path: `${TOOLCHAIN_DIR}/node_modules/${CASEFILE_PACKAGE}/package.json`,
          message: `the installed casefile ${decision.version} declares no \`bin\` to run`,
        },
      ],
    };
  }
  return { kind: "delegate", bin, version: decision.version };
}

/** Runs the installed casefile with this process's Node, stdio and environment, plus the guard. */
export const reexec: Reexec = (plan, argv) => {
  const child = spawnSync(process.execPath, [plan.bin, ...argv], {
    stdio: "inherit",
    env: { ...process.env, [DELEGATED_ENV]: plan.version },
  });
  if (child.error !== undefined) {
    process.stderr.write(`casefile: could not run ${plan.bin}: ${child.error.message}\n`);
    return 1;
  }
  return child.status ?? 1;
};

/** The `casefile` entry of a package's `bin`, as an absolute path; `null` when it has none. */
async function installedBin(packageDir: string): Promise<string | null> {
  const text = await readFile(join(packageDir, "package.json"), "utf8").catch(() => null);
  if (text === null) return null;
  let bin: unknown;
  try {
    bin = (JSON.parse(text) as { bin?: unknown }).bin;
  } catch {
    return null;
  }
  const entry =
    typeof bin === "string"
      ? bin
      : bin !== null && typeof bin === "object"
        ? (bin as Record<string, unknown>)[CASEFILE_PACKAGE]
        : undefined;
  if (typeof entry !== "string") return null;
  const file = resolve(packageDir, entry);
  const rel = relative(packageDir, file);
  // A bin outside its own package is not the package's.
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : file;
}
