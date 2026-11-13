import { z } from "zod";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import { CONFIG_FILE } from "../load/paths.js";
import type { CommitConfig } from "../schema/index.js";

/** Conventional Commits, the default when `casefile.yaml` sets no template (ADR commit-shape-follows-host-repo §2). */
export const DEFAULT_SUBJECT = "{type}({scope}): {summary}";

const PLACEHOLDERS = new Set(["type", "scope", "summary", "ticket"]);
/** A ticket is one token: it lands in a subject line, so no spaces or line breaks. */
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._#/-]*$/;
const TICKET_EXPECTED = "one token of letters, digits and ._#/- (PROJ-123)";

/** The inputs every operation that hands back a commit takes (ADR commit-shape-follows-host-repo §3). */
export const CommitInput = {
  /** The ticket key for a template that names `{ticket}`: `--ticket` in the CLI, a field in the viewer. */
  ticket: z.string().min(1).optional(),
  /** The checked-out branch, filled by the host; `ticket_from_branch` reads the ticket from it. */
  branch: z.string().min(1).optional().meta({ host: "branch" }),
};

/** What the operation knows about its commit; the template decides where each part goes. */
export type SubjectParts = {
  /** `test` for case and run files, `chore` for the setup commit. */
  type: "test" | "chore";
  /** The feature (`cover`, `review`, `run`), the project (`ingest`), `casefile` (setup). */
  scope: string;
  /** What changed: `propose 3 cases`, `edit and approve TC-0003`. */
  summary: string;
};

/**
 * The problems of a subject template, `[]` when it is valid: it must name
 * `{summary}` and no placeholder outside the four.
 */
export function templateProblems(template: string): string[] {
  const named = [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? "");
  const problems = named
    .filter((name) => !PLACEHOLDERS.has(name))
    .map((name) => `unknown placeholder {${name}}: use {type}, {scope}, {summary}, {ticket}`);
  if (!named.includes("summary")) problems.push("the template does not name {summary}");
  return problems;
}

/** The problem of a `ticket_from_branch` regex, `null` when it compiles. */
export function ticketRegexProblem(source: string): string | null {
  try {
    new RegExp(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Whether a ticket is one token a subject can carry. */
export function isTicket(value: string): boolean {
  return TICKET.test(value);
}

/**
 * The subject of a commit casefile hands back: the workspace's template (or
 * the default) filled with the operation's parts and, when the template names
 * `{ticket}`, the ticket typed, else read from the branch, else the default.
 * Pure: the host supplies `branch`. Checked before the operation writes, so a
 * refusal writes nothing.
 */
export function commitSubject(
  config: CommitConfig | undefined,
  parts: SubjectParts,
  input: { ticket?: string; branch?: string },
): Result<string> {
  const template = config?.subject ?? DEFAULT_SUBJECT;
  const problems = templateProblems(template);
  if (problems.length > 0) {
    return fail(configError("config.commit_subject", "commit.subject", problems.join("; ")));
  }
  const values: Record<string, string> = { ...parts };
  if (!template.includes("{ticket}")) {
    if (input.ticket === undefined) return ok(fill(template, values));
    return fail({
      code: "commit.ticket_unused",
      field: "ticket",
      message: `the commit subject template (${template}) names no {ticket}: leave --ticket out`,
    });
  }
  const fromBranch = branchTicket(config?.ticket_from_branch, input.branch);
  if (!fromBranch.ok) return fromBranch;
  const ticket = input.ticket ?? fromBranch.value ?? config?.ticket_default;
  if (ticket === undefined) {
    return fail({
      code: "commit.ticket_missing",
      field: "ticket",
      message: `the commit subject template (${template}) needs a ticket: pass --ticket <key>${
        config?.ticket_from_branch === undefined
          ? ""
          : `, or work on a branch that matches ${config.ticket_from_branch}`
      }, or set commit.ticket_default in ${CONFIG_FILE}`,
    });
  }
  if (!isTicket(ticket)) {
    return fail({
      code: "commit.ticket_invalid",
      field: "ticket",
      message: `'${ticket}' is not a ticket: ${TICKET_EXPECTED}`,
    });
  }
  return ok(fill(template, { ...values, ticket }));
}

/** The ticket `ticket_from_branch` finds in the branch: its first group, else the whole match. */
function branchTicket(
  source: string | undefined,
  branch: string | undefined,
): Result<string | undefined> {
  if (source === undefined || branch === undefined) return ok(undefined);
  const problem = ticketRegexProblem(source);
  if (problem !== null) {
    return fail(configError("config.commit_ticket_regex", "commit.ticket_from_branch", problem));
  }
  const match = new RegExp(source).exec(branch);
  return ok(match === null ? undefined : (match[1] ?? match[0]));
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{(type|scope|summary|ticket)\}/g,
    (_, name: string) => values[name] ?? "",
  );
}

function configError(code: string, field: string, message: string): CasefileError {
  return { code, path: CONFIG_FILE, field, message: `${field} in ${CONFIG_FILE}: ${message}` };
}
