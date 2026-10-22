import { execFile } from "node:child_process";

/**
 * Git adapter: `git config user.email` as Git resolves it in `dir` (local, then
 * global and system config), or `null` when it is unset or Git is unavailable.
 * Hosts fill the `identity` host input with it (ADR cli-generic-host §3).
 */
export function gitUserEmail(
  dir: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["config", "user.email"], { cwd: dir, env }, (error, stdout) => {
      const email = error === null ? stdout.trim() : "";
      resolve(email === "" ? null : email);
    });
  });
}
