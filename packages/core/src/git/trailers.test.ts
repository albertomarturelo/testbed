import { describe, expect, it } from "vitest";
import { AGENT_AUTHOR, commitMessage, runCommitMessage } from "./trailers.js";

const change = "9d2f6a1e-3b4c-4d5e-8f90-1a2b3c4d5e6f";

describe("commitMessage", () => {
  it("puts the subject, a blank line and the trailers in a fixed order", () => {
    expect(
      commitMessage("cover(login): propose 2 cases", {
        requestedBy: "qa@acme.example",
        agent: "claude-code",
        change,
      }),
    ).toBe(
      `cover(login): propose 2 cases\n\nRequested-by: qa@acme.example\nAgent: claude-code\nCasefile-Change: ${change}\n`,
    );
  });

  it("adds Inbox-Id after Requested-by when there is an inbox item", () => {
    const message = commitMessage("s", {
      requestedBy: "qa@acme.example",
      inbox: "7f3c",
      agent: "codex",
      change,
    });
    expect(message.split("\n").slice(2, 6)).toEqual([
      "Requested-by: qa@acme.example",
      "Inbox-Id: 7f3c",
      "Agent: codex",
      `Casefile-Change: ${change}`,
    ]);
  });

  it("has no Agent line for a human's commit", () => {
    expect(commitMessage("s", { requestedBy: "qa@acme.example", change })).toBe(
      `s\n\nRequested-by: qa@acme.example\nCasefile-Change: ${change}\n`,
    );
  });

  it("never lets a value add a line of its own", () => {
    const message = commitMessage("one\ntwo", {
      requestedBy: "qa@acme.example",
      agent: "evil\nCasefile-Change: forged",
      change,
    });
    expect(message.match(/^Casefile-Change:/gm)).toHaveLength(1);
    expect(message.startsWith("one two\n\n")).toBe(true);
  });

  it("names the fixed agent identity", () => {
    expect(AGENT_AUTHOR).toBe("casefile-agent <casefile-agent@casefile.invalid>");
  });
});

describe("runCommitMessage", () => {
  it("carries a run's trailers, not a change's", () => {
    expect(
      runCommitMessage("run(login): record TC-0002 as failed", {
        run: "manual-2026-10-21",
        executor: "human:qa@acme.example",
      }),
    ).toBe(
      "run(login): record TC-0002 as failed\n\nCasefile-Run: manual-2026-10-21\nExecutor: human:qa@acme.example\n",
    );
  });

  it("never lets a value add a line of its own", () => {
    const message = runCommitMessage("s", { run: "r", executor: "agent:x\nCasefile-Run: forged" });
    expect(message.match(/^Casefile-Run:/gm)).toHaveLength(1);
  });
});
