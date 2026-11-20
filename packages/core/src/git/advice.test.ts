import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MONOREPO_ROOT } from "../demo.fixture.js";
import { coverOperation } from "../operations/cover.js";
import { milestoneOpenOperation } from "../operations/milestone-open.js";
import { createRegistry } from "../operations/registry.js";
import { commitAdvice } from "./advice.js";
import { AGENT_AUTHOR, CI_AUTHOR } from "./trailers.js";

describe("commitAdvice (ADR agent-runs-the-commit §2)", () => {
  it("tells a human to stage the file, then commit only it, as themself", () => {
    expect(commitAdvice("the file", { files: ["a/b.yaml"] })).toBe(
      "Commit the file as yourself, with commit.message from --json output saved to a file <message>, staging only it, from the workspace root: `git add -- a/b.yaml` then `git commit -F <message> -- a/b.yaml`",
    );
  });

  it("commits an agent's or CI's files as that author", () => {
    const agent = commitAdvice("both files", { author: AGENT_AUTHOR, files: ["a", "b"] });
    expect(agent).toContain("Commit both files as casefile-agent,");
    expect(agent).toContain("staging only them, from the workspace root:");
    expect(agent).toContain(
      "`git add -- a b` then `git -c user.name=casefile-agent -c user.email=casefile-agent@casefile.invalid commit -F <message> -- a b`",
    );
    expect(commitAdvice("the run file", { author: CI_AUTHOR, files: ["r"] })).toContain(
      "`git -c user.name=casefile-ci -c user.email=casefile-ci@casefile.invalid commit -F <message> -- r`",
    );
  });

  it("names up to three files, quoting what the shell would split, and <files> past that", () => {
    expect(commitAdvice("x", { files: ["a b.png", "it's.png", "c"] })).toContain(
      "`git add -- 'a b.png' 'it'\\''s.png' c`",
    );
    const many = commitAdvice("the created files", { files: ["1", "2", "3", "4"] });
    expect(many).toContain(
      "staging only <files> (each path of commit.files, quoted, as its own argument), from the workspace root:",
    );
    expect(many).toContain("`git add -- <files>` then `git commit -F <message> -- <files>`");
  });
});

describe("following the advice in a repository (#212)", () => {
  const registry = createRegistry();
  registry.register(milestoneOpenOperation);
  registry.register(coverOperation);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  let root = "";
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "casefile-advice-"));
    await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
    git("init", "-q");
    git("config", "user.name", "QA");
    git("config", "user.email", "qa@acme.example");
    git("add", "-A");
    git("commit", "-q", "-m", "demo");
  });
  // Git can still be writing in `.git` as the test ends (ENOTEMPTY): retry.
  afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));

  /** Runs every command the advice names, as printed, with `<message>` a file holding the message. */
  async function follow(advice: string, message: string): Promise<void> {
    const file = join(root, "..", `${root.split("/").pop()}.msg`);
    await writeFile(file, message);
    try {
      const commands = [...advice.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
      expect(commands).toHaveLength(2);
      for (const command of commands) {
        execFileSync("sh", ["-c", command.replaceAll("<message>", file)], { cwd: root, env });
      }
    } finally {
      await rm(file, { force: true });
    }
  }
  const committed = () => git("show", "--name-only", "--format=%an <%ae>", "HEAD").split("\n");

  it("commits the new file milestone open wrote, and nothing else the human staged", async () => {
    await appendFile(join(root, "README.md"), "staged by hand\n");
    git("add", "README.md");
    const result = await registry.invoke(
      "milestone-open",
      {
        identity: "qa@acme.example",
        via: "cli:milestone-open",
        project: "web",
        slug: "uat",
        title: "UAT",
      },
      { root, actor: "human" },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { commit, next } = result.value as {
      commit: { message: string; files: string[] };
      next: string[];
    };
    await follow(next[0] as string, commit.message);
    expect(committed()).toEqual(["QA <qa@acme.example>", "", ...commit.files]);
    expect(git("log", "-1", "--format=%B")).toBe(commit.message.trim());
    expect(git("diff", "--cached", "--name-only")).toBe("README.md");
  });

  it("commits the new case files cover wrote, as casefile-agent", async () => {
    const step = { do: "Submit the form", expect: "The form is rejected" };
    const result = await registry.invoke(
      "cover",
      {
        identity: "qa@acme.example",
        via: "cli:cover",
        agent: "claude-code",
        project: "web",
        feature: "login",
        cases: [
          { title: "Advice one", steps: [step] },
          { title: "Advice two", steps: [step] },
        ],
      },
      { root, actor: "agent" },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const { commit, next } = result.value as {
      commit: { message: string; files: string[] };
      next: string[];
    };
    expect(commit.files).toHaveLength(2);
    await follow(next[0] as string, commit.message);
    expect(committed()).toEqual([AGENT_AUTHOR, "", ...commit.files]);
    expect(git("status", "--porcelain")).toBe("");
  });
});
