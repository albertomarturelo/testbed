import type { CasefileError } from "../errors.js";
import { ExactVersion } from "../schema/index.js";
import { FINDING_CODES } from "../validate/finding.js";
import { CASEFILE_PACKAGE, TOOLCHAIN_DIR, type Toolchain } from "./extensions.js";

export const TOOLCHAIN_PACKAGE = `${TOOLCHAIN_DIR}/package.json`;
export const NPM_INSTALL = `npm install --prefix ${TOOLCHAIN_DIR} --ignore-scripts`;

/** Set on a re-executed casefile so it never delegates again (ADR casefile-toolchain-dir §4). */
export const DELEGATED_ENV = "CASEFILE_DELEGATED";

/**
 * Why `name` is not usable as declared, or `null`: not installed at all, or a
 * version other than its exact pin in `.casefile/package.json` (a stale install).
 */
export function notInstalled(toolchain: Toolchain, name: string): string | null {
  const installed = Object.hasOwn(toolchain.installed, name)
    ? toolchain.installed[name]
    : undefined;
  if (installed === undefined) return `${name} is not installed in ${TOOLCHAIN_DIR}/node_modules`;
  const pin = toolchain.declared?.[name];
  if (pin !== undefined && ExactVersion.safeParse(pin).success && installed !== pin) {
    return `${name} ${pin} is pinned in ${TOOLCHAIN_PACKAGE} but ${installed} is installed`;
  }
  return null;
}

export type Delegation =
  | { action: "run" }
  | { action: "delegate"; version: string }
  | { action: "fail"; error: CasefileError & { hint: string } };

/**
 * Whether the running casefile (`running`) runs the command itself, re-executes
 * the one installed in `.casefile/`, or cannot run (ADR casefile-toolchain-dir
 * §4). Pure: the host reads the toolchain and does the re-exec. Without a
 * workspace (`null`), a `.casefile/package.json` or a casefile entry in it,
 * nothing is pinned. An exact pin equal to `running` needs no install: the right
 * version is already running.
 */
export function toolchainDelegation(toolchain: Toolchain | null, running: string): Delegation {
  const pin = toolchain?.declared?.[CASEFILE_PACKAGE];
  if (toolchain === null || pin === undefined) return { action: "run" };
  const problem = notInstalled(toolchain, CASEFILE_PACKAGE);
  if (problem !== null) {
    if (pin === running) return { action: "run" };
    return {
      action: "fail",
      error: {
        code: "toolchain.not_installed",
        path: TOOLCHAIN_PACKAGE,
        field: `dependencies.${CASEFILE_PACKAGE}`,
        message: `${problem}; this is casefile ${running}`,
        hint: FINDING_CODES["toolchain.not_installed"].hint as string,
      },
    };
  }
  const installed = toolchain.installed[CASEFILE_PACKAGE] as string;
  return installed === running ? { action: "run" } : { action: "delegate", version: installed };
}
