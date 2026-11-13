import { describe, expect, it } from "vitest";
import { commitSubject, DEFAULT_SUBJECT, templateProblems, ticketRegexProblem } from "./subject.js";

const parts = { type: "test", scope: "login", summary: "approve TC-0003" } as const;
const TEMPLATE = "[{ticket}] {type}({scope}): {summary}";

describe("commitSubject (ADR commit-shape-follows-host-repo)", () => {
  it("defaults to Conventional Commits", () => {
    expect(DEFAULT_SUBJECT).toBe("{type}({scope}): {summary}");
    expect(commitSubject(undefined, parts, {})).toEqual({
      ok: true,
      value: "test(login): approve TC-0003",
    });
    expect(
      commitSubject(
        {},
        { ...parts, type: "chore", scope: "casefile", summary: "register web" },
        {},
      ),
    ).toEqual({ ok: true, value: "chore(casefile): register web" });
  });

  it("fills the workspace's template, the ticket typed first", () => {
    const config = {
      subject: TEMPLATE,
      ticket_from_branch: "([A-Z]+-[0-9]+)",
      ticket_default: "NO-TICKET",
    };
    expect(
      commitSubject(config, parts, { ticket: "QA-7", branch: "feature/PROJ-123-login" }),
    ).toEqual({
      ok: true,
      value: "[QA-7] test(login): approve TC-0003",
    });
  });

  it("else takes the ticket from the branch: first group, else the whole match", () => {
    const branch = "feature/PROJ-123-login";
    expect(
      commitSubject({ subject: TEMPLATE, ticket_from_branch: "([A-Z]+-[0-9]+)" }, parts, {
        branch,
      }),
    ).toEqual({ ok: true, value: "[PROJ-123] test(login): approve TC-0003" });
    expect(
      commitSubject({ subject: TEMPLATE, ticket_from_branch: "[A-Z]+-[0-9]+" }, parts, { branch }),
    ).toEqual({ ok: true, value: "[PROJ-123] test(login): approve TC-0003" });
  });

  it("else uses the default ticket", () => {
    const config = {
      subject: TEMPLATE,
      ticket_from_branch: "([A-Z]+-[0-9]+)",
      ticket_default: "NO-TICKET",
    };
    expect(commitSubject(config, parts, { branch: "main" })).toEqual({
      ok: true,
      value: "[NO-TICKET] test(login): approve TC-0003",
    });
  });

  it("refuses a template that needs a ticket when none is found", () => {
    const result = commitSubject(
      { subject: TEMPLATE, ticket_from_branch: "(PROJ-[0-9]+)" },
      parts,
      {
        branch: "main",
      },
    );
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "commit.ticket_missing", field: "ticket" }],
    });
    expect(!result.ok && result.errors[0]?.message).toContain("--ticket");
  });

  it("refuses a ticket that is not one token, and a ticket the template does not use", () => {
    expect(
      commitSubject({ subject: TEMPLATE }, parts, { ticket: "PROJ 1\nAgent: x" }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "commit.ticket_invalid", field: "ticket" }],
    });
    expect(commitSubject(undefined, parts, { ticket: "PROJ-1" })).toMatchObject({
      ok: false,
      errors: [{ code: "commit.ticket_unused", field: "ticket" }],
    });
  });

  it("refuses a broken template or regex with the config's location", () => {
    expect(commitSubject({ subject: "{type}: {what}" }, parts, {})).toMatchObject({
      ok: false,
      errors: [{ code: "config.commit_subject", path: "casefile.yaml", field: "commit.subject" }],
    });
    expect(
      commitSubject({ subject: TEMPLATE, ticket_from_branch: "(" }, parts, { branch: "main" }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "config.commit_ticket_regex", field: "commit.ticket_from_branch" }],
    });
  });
});

describe("templateProblems / ticketRegexProblem", () => {
  it("needs {summary} and knows four placeholders", () => {
    expect(templateProblems(TEMPLATE)).toEqual([]);
    expect(templateProblems("{type}({scope})")).toEqual(["the template does not name {summary}"]);
    expect(templateProblems("{summary} {Ticket}")).toEqual([
      "unknown placeholder {Ticket}: use {type}, {scope}, {summary}, {ticket}",
    ]);
  });

  it("says why a regex does not compile", () => {
    expect(ticketRegexProblem("([A-Z]+-[0-9]+)")).toBeNull();
    expect(ticketRegexProblem("(")).toEqual(expect.any(String));
  });
});
