import { type CasefileError, fail, ok } from "../errors.js";
import { defineIngester, type IngestedResult } from "./ingester.js";
import { parseXml, type XmlElement } from "./xml.js";

/** A time with a zone: `Z` or `±hh:mm` / `±hhmm`. Zone-less report times are ambiguous. */
const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/;

/** What a `testsuite` passes down to the suites and test cases inside it. */
type Suite = { name?: string; timestamp?: string };

/**
 * JUnit XML (`<testsuites>` or a single `<testsuite>`, nested suites allowed),
 * as written by Playwright, Jest, Surefire, pytest… One result per `testcase`
 * (`casefile spec ingest`):
 *
 * - `ref`: `<classname>::<name>` (the nearest suite's `name` when `classname` is
 *   missing). Playwright: `login.spec.ts::rejects an empty password`.
 * - `status`: `failed` with a `failure` or `error` child, `skipped` with
 *   `skipped`, else `passed`.
 * - `at`: the case's or nearest suite's `timestamp`, when it has a time zone.
 * - `duration_ms`: `time` (seconds) × 1000, rounded.
 */
export const junitIngester = defineIngester({
  format: "junit",
  spec: "specs/ingest.md",
  parse(text, { path }) {
    const document = parseXml(text, path);
    if (!document.ok) return document;
    const root = document.value;
    if (root.name !== "testsuites" && root.name !== "testsuite") {
      return fail({
        code: "ingest.invalid_report",
        path,
        line: root.line,
        column: root.column,
        message: `<${root.name}> is not a JUnit report: the root must be <testsuites> or <testsuite>`,
      });
    }

    const results: IngestedResult[] = [];
    const errors: CasefileError[] = [];
    const pending: [XmlElement, Suite][] = [[root, {}]];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const [element, outer] = next;
      if (element.name === "testcase") {
        const result = testCase(element, outer);
        if (typeof result === "string") {
          errors.push({
            code: "ingest.invalid_report",
            path,
            line: element.line,
            column: element.column,
            message: result,
          });
        } else results.push(result);
        continue;
      }
      if (element.name !== "testsuites" && element.name !== "testsuite") continue;
      const suite: Suite =
        element.name === "testsuite"
          ? {
              name: element.attributes.name || outer.name,
              timestamp: element.attributes.timestamp ?? outer.timestamp,
            }
          : outer;
      // Reversed onto the stack, so results keep document order.
      for (const child of [...element.children].reverse()) pending.push([child, suite]);
    }
    return errors.length > 0 ? fail(...errors) : ok(results);
  },
});

function testCase(element: XmlElement, suite: Suite): IngestedResult | string {
  const { name, classname, time, timestamp } = element.attributes;
  if (!name) return "<testcase> has no name";
  const owner = classname || suite.name;
  const children = new Set(element.children.map((child) => child.name));
  const status =
    children.has("failure") || children.has("error")
      ? "failed"
      : children.has("skipped")
        ? "skipped"
        : "passed";
  const result: IngestedResult = { ref: owner ? `${owner}::${name}` : name, status };
  const at = zonedTime(timestamp ?? suite.timestamp);
  if (at !== undefined) result.at = at;
  const seconds = time === undefined ? Number.NaN : Number(time.replaceAll(",", ""));
  if (Number.isFinite(seconds) && seconds >= 0) result.duration_ms = Math.round(seconds * 1000);
  return result;
}

/** ISO time in UTC without milliseconds, as casefile writes `at`; `undefined` without a zone. */
function zonedTime(value: string | undefined): string | undefined {
  if (value === undefined || !ZONED.test(value.trim())) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
