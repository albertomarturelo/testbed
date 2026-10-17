import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IngestedResult } from "./ingester.js";
import { junitIngester } from "./junit.js";

/** JUnit reports as Playwright and Maven Surefire write them. */
const JUNIT_FIXTURES = fileURLToPath(new URL("../../fixtures/junit/", import.meta.url));

const parse = async (text: string) => junitIngester.parse(text, { path: "report.xml" });
const fixture = async (name: string) => {
  const result = await parse(await readFile(`${JUNIT_FIXTURES}${name}`, "utf8"));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
};

describe("junitIngester", () => {
  it("reads a Playwright report: <file>::<title path>, statuses, project, suite time, durations", async () => {
    const results = await fixture("playwright.xml");
    expect(results).toEqual([
      {
        ref: "login.spec.ts::signs in with valid credentials",
        status: "passed",
        source: "chromium",
        at: "2026-10-17T09:12:03Z",
        duration_ms: 1204,
      },
      {
        ref: "login.spec.ts::rejects an empty password",
        status: "failed",
        source: "chromium",
        at: "2026-10-17T09:12:03Z",
        duration_ms: 611,
      },
      {
        ref: "login.spec.ts::password reset › sends a reset link to a registered email",
        status: "passed",
        source: "chromium",
        at: "2026-10-17T09:12:03Z",
        duration_ms: 873,
      },
      {
        ref: "login.spec.ts::locks the account after five failed attempts",
        status: "skipped",
        source: "chromium",
        at: "2026-10-17T09:12:03Z",
        duration_ms: 0,
      },
      {
        ref: "login.spec.ts::signs out from the account menu",
        status: "passed",
        source: "chromium",
        at: "2026-10-17T09:12:03Z",
        duration_ms: 824,
      },
      {
        ref: "search.spec.ts::finds a product by name & shows its price",
        status: "passed",
        source: "chromium",
        at: "2026-10-17T09:12:03Z",
        duration_ms: 615,
      },
    ]);
    for (const result of results) expect(IngestedResult.parse(result)).toEqual(result);
  });

  it("reads a Surefire report: errors fail, suite name stands in for classname, zone-less time is dropped", async () => {
    expect(await fixture("surefire.xml")).toEqual([
      {
        ref: "com.acme.orders.OrderApiTest::createsAnOrder",
        status: "passed",
        duration_ms: 1204500,
      },
      {
        ref: "com.acme.orders.OrderApiTest::rejectsAnEmptyCart",
        status: "failed",
        duration_ms: 311,
      },
      {
        ref: "com.acme.orders.OrderApiTest::cancelsAnOrder",
        status: "skipped",
        at: "2026-10-17T09:12:05Z",
        duration_ms: 200,
      },
      {
        ref: "com.acme.orders.OrderApiTest$Refunds::refundsAPaidOrder",
        status: "passed",
        duration_ms: 400,
      },
    ]);
  });

  it("uses the bare name without a classname or suite name, and ignores a bad time", async () => {
    const result = await parse(`<testsuite><testcase name="t" time="soon"/></testsuite>`);
    expect(result).toEqual({ ok: true, value: [{ ref: "t", status: "passed" }] });
  });

  it("reads an empty report as no results", async () => {
    expect(await parse("<testsuites/>")).toEqual({ ok: true, value: [] });
  });

  it("refuses a root that is not a JUnit report", async () => {
    expect(await parse(`<?xml version="1.0"?>\n<report/>`)).toEqual({
      ok: false,
      errors: [
        {
          code: "ingest.invalid_report",
          path: "report.xml",
          line: 2,
          column: 1,
          message: "<report> is not a JUnit report: the root must be <testsuites> or <testsuite>",
        },
      ],
    });
  });

  it("reports every test case without a name, with its line", async () => {
    const result = await parse(
      `<testsuite name="s">\n<testcase/>\n<testcase name="ok"/>\n<testcase name=""/>\n</testsuite>`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => [e.code, e.line, e.message])).toEqual([
      ["ingest.invalid_report", 2, "<testcase> has no name"],
      ["ingest.invalid_report", 4, "<testcase> has no name"],
    ]);
  });

  it("passes XML errors through", async () => {
    const result = await parse("<testsuites><testsuite></testsuites>");
    expect(result).toMatchObject({ ok: false, errors: [{ code: "ingest.invalid_report" }] });
  });
});
