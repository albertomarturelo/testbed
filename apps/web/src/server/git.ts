import { spawn } from "node:child_process";
import { fail, type Identity, type Result } from "@casefile/core";

/** The commit a writing operation returned: its message and the files to stage. */
export type ReturnedCommit = { message: string; files: readonly string[] };

/**
 * Runs the commit as the human (ADR human-writes-through-operations §2):
 * `git add -- <files>`, then `git commit -F - -- <files>`, so nothing else the
 * human had staged lands in it (ADR agent-runs-the-commit §2). The author is
 * git's own identity, unless casefile resolved another one: then `-c user.*`
 * names it (ADR identity-override §4). Answers the new commit's sha.
 */
export async function commitAsHuman(
  root: string,
  commit: ReturnedCommit,
  identity: Identity | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<{ sha: string }>> {
  const files = [...commit.files];
  const as =
    identity === null || identity.source === "git"
      ? []
      : [
          "-c",
          `user.name=${identity.name ?? identity.email}`,
          "-c",
          `user.email=${identity.email}`,
        ];
  const added = await git(root, env, "add", ["add", "--", ...files]);
  if (!added.ok) return added;
  const committed = await git(
    root,
    env,
    "commit",
    [...as, "commit", "--quiet", "-F", "-", "--", ...files],
    commit.message,
  );
  if (!committed.ok) return committed;
  const sha = await git(root, env, "rev-parse", ["rev-parse", "HEAD"]);
  return sha.ok ? { ok: true, value: { sha: sha.value.trim() } } : sha;
}

/** One git command in `cwd`; a non-zero exit is `ui.commit_failed` with git's stderr. */
function git(
  cwd: string,
  env: NodeJS.ProcessEnv,
  verb: string,
  args: readonly string[],
  stdin?: string,
): Promise<Result<string>> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => resolve(failed(verb, error.message)));
    child.on("close", (code) =>
      resolve(code === 0 ? { ok: true, value: stdout } : failed(verb, stderr.trim(), code)),
    );
    child.stdin.end(stdin ?? "");
  });
}

function failed(verb: string, detail: string, code?: number | null): Result<never> {
  const exit = code === undefined || code === null ? "" : ` (exit ${code})`;
  return fail({
    code: "ui.commit_failed",
    message: `git ${verb} failed${exit}: ${detail} — the files are written; commit them yourself with commit.message, staging only commit.files`,
  });
}
