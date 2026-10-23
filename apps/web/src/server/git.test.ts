import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitAsHuman } from "./git.js";

/** No global or system git config: only the temp repository's own counts. */
const isolated = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (root: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: root, env: isolated, encoding: "utf8" }).trimEnd();

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-web-git-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Dev");
  git(root, "config", "user.email", "dev@acme.example");
  await writeFile(join(root, "case.md"), "a case\n");
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("commitAsHuman", () => {
  it("commits exactly the files, with the message, and answers the sha", async () => {
    await writeFile(join(root, "stray.md"), "not this\n");
    const made = await commitAsHuman(
      root,
      { message: "a\n\nb: c\n", files: ["case.md"] },
      null,
      isolated,
    );
    expect(made).toEqual({ ok: true, value: { sha: git(root, "rev-parse", "HEAD") } });
    expect(`${git(root, "show", "--no-patch", "--format=%B", "HEAD")}\n`).toBe("a\n\nb: c\n");
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("case.md");
  });

  it("reports a commit that exits before reading its message, never an uncaught EPIPE (#122)", async () => {
    // pre-commit runs before git reads `-F -`; a message larger than the pipe
    // buffer cannot be written before git exits, so the write meets a closed pipe.
    const hook = join(root, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho 'blocked by the hook' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    const message = `subject\n\n${"x".repeat(1024 * 1024)}\n`;
    const made = await commitAsHuman(root, { message, files: ["case.md"] }, null, isolated);
    expect(made).toMatchObject({
      ok: false,
      errors: [
        {
          code: "ui.commit_failed",
          message: expect.stringMatching(/git commit failed \(exit 1\): blocked by the hook/),
        },
      ],
    });
    expect(() => git(root, "rev-parse", "HEAD")).toThrow();
  });
});
