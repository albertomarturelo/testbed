import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitLastCommit, signatureStatus } from "./history.js";

/** No global or system config: only the repository's own counts. */
const isolated = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const EVIDENCE = "context/milestones/web-1.2.0/evidence.md";

let dir = "";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, env: isolated, encoding: "utf8" });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "casefile-history-"));
  git("init", "-q");
  git("config", "user.name", "Lead");
  git("config", "user.email", "lead@acme.example");
  await mkdir(join(dir, "context/milestones/web-1.2.0"), { recursive: true });
  await writeFile(join(dir, EVIDENCE), "# Milestone evidence: Web 1.2.0\n");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("signatureStatus", () => {
  it("maps Git's %G? codes", () => {
    expect(signatureStatus("G")).toBe("verified");
    expect(signatureStatus("B")).toBe("bad");
    expect(signatureStatus("N")).toBe("none");
    expect(signatureStatus("")).toBe("none");
    for (const code of ["U", "X", "Y", "R", "E"]) expect(signatureStatus(code)).toBe("unverified");
  });
});

describe("gitLastCommit", () => {
  it("is null while the file is not committed, and outside a repository", async () => {
    git("commit", "-q", "--allow-empty", "-m", "init");
    expect(await gitLastCommit(dir, EVIDENCE, isolated)).toBeNull();
    const outside = await mkdtemp(join(tmpdir(), "casefile-no-repo-"));
    try {
      expect(await gitLastCommit(outside, EVIDENCE, isolated)).toBeNull();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("names the commit that wrote the file, unsigned, and notices a later edit", async () => {
    git("add", EVIDENCE);
    // Committed three hours west of UTC: reported in UTC, like the evidence.
    execFileSync("git", ["commit", "-q", "-m", "test(web): close milestone web-1.2.0"], {
      cwd: dir,
      env: { ...isolated, GIT_COMMITTER_DATE: "2026-11-20T15:48:58-03:00" },
    });
    const sha = git("rev-parse", "HEAD").trim();
    // A later commit that does not touch the file does not count.
    git("commit", "-q", "--allow-empty", "-m", "other");

    const commit = await gitLastCommit(dir, EVIDENCE, isolated);
    expect(commit).toMatchObject({
      sha,
      author: "Lead <lead@acme.example>",
      signature: "none",
      signer: null,
      at: "2026-11-20T18:48:58Z",
      modified: false,
    });

    await writeFile(join(dir, EVIDENCE), "# Milestone evidence: edited\n");
    expect((await gitLastCommit(dir, EVIDENCE, isolated))?.modified).toBe(true);
  });

  it("reports an SSH signature as verified only for a key the repository trusts", async () => {
    try {
      execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(dir, "key")]);
    } catch {
      return; // No ssh-keygen here: the mapping above still covers the codes.
    }
    git("config", "gpg.format", "ssh");
    git("config", "user.signingkey", join(dir, "key.pub"));
    git("add", EVIDENCE);
    git("commit", "-q", "-S", "-m", "test(web): close milestone web-1.2.0");

    // Signed, but no allowed signers to check against: Git cannot vouch for it.
    expect((await gitLastCommit(dir, EVIDENCE, isolated))?.signature).toBe("unverified");

    const key = (await readFile(join(dir, "key.pub"), "utf8")).trim();
    await writeFile(join(dir, "allowed"), `lead@acme.example ${key}\n`);
    git("config", "gpg.ssh.allowedSignersFile", join(dir, "allowed"));
    const commit = await gitLastCommit(dir, EVIDENCE, isolated);
    expect(commit?.signature).toBe("verified");
    expect(commit?.signer).toBe("lead@acme.example");
  });
});
