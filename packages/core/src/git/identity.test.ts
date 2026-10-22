import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitUserEmail } from "./identity.js";

/** No global or system config: only the repository's own counts. */
const isolated = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "casefile-identity-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, env: isolated });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("gitUserEmail", () => {
  it("reads the email Git would commit with", async () => {
    execFileSync("git", ["config", "user.email", "qa@acme.example"], { cwd: dir, env: isolated });
    expect(await gitUserEmail(dir, isolated)).toBe("qa@acme.example");
  });

  it("is null when no config sets it", async () => {
    expect(await gitUserEmail(dir, isolated)).toBeNull();
  });
});
