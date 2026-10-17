import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillsDir } from "./cli.js";

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "casefile-skills-"));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

describe("skillsDir", () => {
  it("uses the packed skills/ when the package has one", async () => {
    const pkg = join(tmp, "apps/cli");
    await mkdir(join(pkg, "skills"), { recursive: true });
    await writeFile(join(tmp, "pnpm-workspace.yaml"), "");
    expect(skillsDir(pkg)).toBe(join(pkg, "skills"));
  });

  it("falls back to the repository's skills/ only inside its own monorepo", async () => {
    const pkg = join(tmp, "apps/cli");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(tmp, "pnpm-workspace.yaml"), "");
    expect(skillsDir(pkg)).toBe(join(tmp, "skills"));
  });

  it("never reads outside an installed package", async () => {
    // `.casefile/node_modules/casefile` without skills/: `.casefile/skills` is the user's.
    const pkg = join(tmp, ".casefile/node_modules/casefile");
    await mkdir(join(tmp, ".casefile/skills"), { recursive: true });
    await mkdir(pkg, { recursive: true });
    expect(skillsDir(pkg)).toBe(join(pkg, "skills"));
  });
});
