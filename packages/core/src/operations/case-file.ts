import { Document, isScalar, isSeq, Scalar, visit } from "yaml";
import { z } from "zod";
import { fail, ok, type Result } from "../errors.js";
import { AGENT_AUTHOR, commitMessage } from "../git/trailers.js";
import { Email, TestCaseFile } from "../schema/index.js";
import type { Actor } from "./operation.js";

/**
 * What every operation that writes case files needs to know about who writes
 * (ADR human-writes-through-operations): spread into its input.
 */
export const WriterInput = {
  /** The person at the keyboard: `git config user.email` in the workspace. */
  identity: Email.optional().meta({ host: "identity" }),
  /** Agent only: the human who asked, when it is not `identity` (an inbox item's author). */
  requestedBy: Email.optional(),
  /** The agent applying it: the `Agent:` trailer. Required for an agent, refused for a human. */
  agent: z.string().min(1).optional(),
  /** The inbox item the request came from; `history[].inbox` and `Inbox-Id:`. */
  inbox: z.string().min(1).optional(),
  /** Where the call came from, `cli:<operation>` or `ui:<operation>`: `history[].via`. */
  via: z
    .string()
    .regex(/^[a-z]+:[a-z][a-z0-9-]*$/, "<host>:<operation>")
    .meta({ host: "via" }),
};

type Writer = { identity?: string; requestedBy?: string; agent?: string };

/**
 * Who a write is by: `requestedBy`, else `identity`. An agent names itself; a
 * human does neither, so the entry and the commit always name the same person.
 */
export function writtenBy(
  operation: string,
  actor: Actor,
  input: Writer,
): Result<{ by: string; agent?: string }> {
  if (actor === "agent" && input.agent === undefined) {
    return fail({
      code: `${operation}.agent_required`,
      field: "agent",
      message: "an agent names itself with --agent <name> (the Agent: trailer)",
    });
  }
  if (actor !== "agent" && input.agent !== undefined) {
    return fail({
      code: `${operation}.agent_not_allowed`,
      field: "agent",
      message: "--agent is for agents: a human's commit carries no Agent: trailer",
    });
  }
  if (actor !== "agent" && input.requestedBy !== undefined) {
    return fail({
      code: `${operation}.requested_by_not_allowed`,
      field: "requestedBy",
      message: "--requested-by is for agents: a human's own identity is used",
    });
  }
  const by = input.requestedBy ?? input.identity;
  if (by === undefined) {
    return fail({
      code: "identity.missing",
      field: "identity",
      message:
        "no `git config user.email` in the workspace: set it, so the change names who made it",
    });
  }
  return ok(input.agent === undefined ? { by } : { by, agent: input.agent });
}

/**
 * The commit a writing operation returns (ADR agent-runs-the-commit): an agent's
 * is authored by `casefile-agent`; a human commits as themself, so no author.
 */
export function writeCommit(
  subject: string,
  trailers: { requestedBy: string; inbox?: string; agent?: string; change: string },
): { author?: string; message: string } {
  const message = commitMessage(subject, trailers);
  return trailers.agent === undefined ? { message } : { author: AGENT_AUTHOR, message };
}

export const WriteCommit = z.strictObject({
  author: z.string().optional(),
  message: z.string(),
});

/** Frontmatter keys casefile writes, in this order; the rest follow schema order. */
const OWN_KEYS = ["id", "feature", "title", "state", "origin"] as const;

/** Lists of short tokens read better on one line: `surfaces: [web]`. */
const FLOW_LISTS = new Set(["surfaces", "work_items", "duplicates_checked_against"]);

/**
 * The frontmatter block, `---` lines included: casefile's keys first and the
 * rest in schema order, short lists inline, timestamps quoted (as in
 * `casefile spec cover`).
 */
export function caseFrontmatter(file: TestCaseFile): string {
  const order = [...OWN_KEYS, ...Object.keys(TestCaseFile.shape)];
  const record = file as Record<string, unknown>;
  const ordered = Object.fromEntries(
    [...new Set(order)].filter((key) => record[key] !== undefined).map((key) => [key, record[key]]),
  );
  const doc = new Document(ordered);
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (FLOW_LISTS.has(key) && isSeq(pair.value)) pair.value.flow = true;
      if (key === "at" && isScalar(pair.value)) pair.value.type = Scalar.QUOTE_DOUBLE;
    },
  });
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n`;
}

/** The body written for `notes`: one blank line, the trimmed Markdown, a final newline. */
export function notesBody(notes: string | null | undefined): string {
  return notes?.trim() ? `\n${notes.trim()}\n` : "";
}

/** A new case file. */
export function caseText(file: TestCaseFile, notes: string | undefined): string {
  return caseFrontmatter(file) + notesBody(notes);
}

/**
 * Everything after the closing `---` line, byte for byte (line endings kept,
 * unlike `splitFrontmatter`'s body): what a rewrite of the frontmatter keeps.
 */
export function bodyBytes(text: string): string {
  const head = /^﻿?---\r?\n(?:[\s\S]*?\n)?---(?:\r?\n|$)/.exec(text);
  return head === null ? "" : text.slice(head[0].length);
}

/** Titles compare without case or repeated spaces: "Sign in" = "sign  in". */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** One line: titles are listed in tables (CLI, UI). */
export const CaseTitle = z.string().regex(/^[^\r\n]+$/, "one line, no line breaks");
