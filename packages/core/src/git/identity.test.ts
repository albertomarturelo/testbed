import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitUserEmail, resolveIdentity } from "./identity.js";

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

describe("resolveIdentity (ADR identity-override)", () => {
  const git = { email: "dev@acme.example", name: "Dev" };
  const env = { email: "qa@acme.example", name: "QA Lead" };

  it("takes the explicit value over the environment over git", () => {
    expect(resolveIdentity({ explicit: "lead@acme.example", env, git })).toEqual({
      ok: true,
      value: { email: "lead@acme.example", source: "explicit" },
    });
    expect(resolveIdentity({ env, git })).toEqual({
      ok: true,
      value: { email: "qa@acme.example", name: "QA Lead", source: "env" },
    });
    expect(resolveIdentity({ git })).toEqual({
      ok: true,
      value: { email: "dev@acme.example", name: "Dev", source: "git" },
    });
  });

  it("answers from the environment when git is unconfigured, and null when nothing is", () => {
    expect(resolveIdentity({ env: { email: "qa@acme.example" }, git: { email: null } })).toEqual({
      ok: true,
      value: { email: "qa@acme.example", source: "env" },
    });
    expect(resolveIdentity({ git: { email: null, name: null } })).toEqual({
      ok: true,
      value: null,
    });
    expect(resolveIdentity({})).toEqual({ ok: true, value: null });
  });

  it("ignores a blank variable and names the source of a malformed email", () => {
    expect(resolveIdentity({ env: { email: "  " }, git })).toMatchObject({
      value: { source: "git" },
    });
    expect(resolveIdentity({ env: { email: "qa-lead" }, git })).toMatchObject({
      ok: false,
      errors: [
        {
          code: "identity.invalid",
          field: "identity",
          message: expect.stringContaining("CASEFILE_USER_EMAIL"),
        },
      ],
    });
  });
});
