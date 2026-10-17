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
  /** The agent that made the change (`claude-code`). */
  agent: string;
  /** The change id every `history` entry of the commit stores (ADR history-commit-reference). */
  change: string;
};

/**
 * A casefile commit message: subject, blank line, then the trailers in a fixed
 * order (ADR git-is-identity, agent-runs-the-commit). Ends with a newline.
 * Line breaks in values are flattened so a value cannot forge another trailer.
 */
export function commitMessage(subject: string, trailers: CommitTrailers): string {
  const line = (value: string) => value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const lines = [
    `Requested-by: ${line(trailers.requestedBy)}`,
    ...(trailers.inbox === undefined ? [] : [`Inbox-Id: ${line(trailers.inbox)}`]),
    `Agent: ${line(trailers.agent)}`,
    `Casefile-Change: ${line(trailers.change)}`,
  ];
  return `${line(subject)}\n\n${lines.join("\n")}\n`;
}
