/**
 * The identity every agent commit is authored with (ADR agent-runs-the-commit §3).
 * `.invalid` is reserved (RFC 2606): the address cannot belong to anyone.
 */
export const AGENT_AUTHOR = "casefile-agent <casefile-agent@casefile.invalid>";

export type CommitTrailers = {
  /** The human who asked: `git config user.email` or the inbox item's author. */
  requestedBy: string;
  /** The inbox item, when the request came through `.inbox/`. */
  inbox?: string;
  /** The agent that made the change (`claude-code`); absent when a human made it. */
  agent?: string;
  /** The change id every `history` entry of the commit stores (ADR history-commit-reference). */
  change: string;
};

/**
 * A casefile commit message: subject, blank line, then the trailers in a fixed
 * order (ADR git-is-identity, agent-runs-the-commit). A human's commit has no
 * `Agent:` line (ADR human-writes-through-operations). Ends with a newline.
 * Line breaks in values are flattened so a value cannot forge another trailer.
 */
export function commitMessage(subject: string, trailers: CommitTrailers): string {
  return message(subject, [
    `Requested-by: ${line(trailers.requestedBy)}`,
    ...(trailers.inbox === undefined ? [] : [`Inbox-Id: ${line(trailers.inbox)}`]),
    ...(trailers.agent === undefined ? [] : [`Agent: ${line(trailers.agent)}`]),
    `Casefile-Change: ${line(trailers.change)}`,
  ]);
}

export type RunTrailers = {
  /** The run id: names the run file `.runs/<run>.jsonl`. */
  run: string;
  /** The events' `executor`: `human:<email>`, `agent:<name>`, `ci:<name>`. */
  executor: string;
};

/**
 * The commit message of a run file (ADR ci-commits-run-files §2): the trailers
 * `Casefile-Run:` and `Executor:` replace `Requested-by:` and `Casefile-Change:`,
 * since a run writes no `history` entry and answers no one's request.
 */
export function runCommitMessage(subject: string, trailers: RunTrailers): string {
  return message(subject, [
    `Casefile-Run: ${line(trailers.run)}`,
    `Executor: ${line(trailers.executor)}`,
  ]);
}

/** Line breaks in values are flattened so a value cannot forge another trailer. */
function line(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

function message(subject: string, trailers: readonly string[]): string {
  return `${line(subject)}\n\n${trailers.join("\n")}\n`;
}
