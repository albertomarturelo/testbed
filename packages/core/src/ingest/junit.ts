import { posix } from "node:path";
import { type CasefileError, fail, ok } from "../errors.js";
import { defineIngester, type IngestedResult } from "./ingester.js";
import { parseXml, type XmlElement } from "./xml.js";

/** A time with a zone: `Z` or `±hh:mm` / `±hhmm`. Zone-less report times are ambiguous. */
const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/;

/** What a `testsuite` passes down to the suites and test cases inside it. */
type Suite = { name?: string; timestamp?: string; hostname?: string };

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
 * - `source`: the nearest suite's `hostname`: the project name in Playwright.
 * - `note`: the `failure` / `error` text, dedented; without text, its `message`.
 * - `evidence`: `[[ATTACHMENT|<path>]]` lines in `system-out` (Playwright), a
 *   relative path made workspace-relative from the report's directory, an
 *   absolute one kept as written (ADR run-event-note).
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
        const result = testCase(element, outer, path);
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
              hostname: element.attributes.hostname || outer.hostname,
            }
          : outer;
      // Reversed onto the stack, so results keep document order.
      for (const child of [...element.children].reverse()) pending.push([child, suite]);
    }
    return errors.length > 0 ? fail(...errors) : ok(results);
  },
});

function testCase(element: XmlElement, suite: Suite, report: string): IngestedResult | string {
  const { name, classname, time, timestamp } = element.attributes;
  if (!name) return "<testcase> has no name";
  const owner = classname || suite.name;
  const failure = element.children.find((c) => c.name === "failure" || c.name === "error");
  const status =
    failure !== undefined
      ? "failed"
      : element.children.some((c) => c.name === "skipped")
        ? "skipped"
        : "passed";
  const result: IngestedResult = { ref: owner ? `${owner}::${name}` : name, status };
  if (suite.hostname) result.source = suite.hostname;
  const note =
    failure === undefined ? "" : dedent(failure.text) || failure.attributes.message?.trim();
  if (note) result.note = note;
  const evidence = attachments(element, report);
  if (evidence.length > 0) result.evidence = evidence;
  const at = zonedTime(timestamp ?? suite.timestamp);
  if (at !== undefined) result.at = at;
  const seconds = time === undefined ? Number.NaN : Number(time.replaceAll(",", ""));
  if (Number.isFinite(seconds) && seconds >= 0) result.duration_ms = Math.round(seconds * 1000);
  return result;
}

/** Without blank edge lines and the indentation every line shares. */
function dedent(text: string): string {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && (lines[0] as string).trim() === "") lines.shift();
  while (lines.length > 0 && (lines.at(-1) as string).trim() === "") lines.pop();
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => (/^[ \t]*/.exec(line) as RegExpExecArray)[0].length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(common).trimEnd()).join("\n");
}

const ATTACHMENT = /\[\[ATTACHMENT\|([^\]\r\n]+)\]\]/g;

/** `/home/ci/a.png`, `C:/ci/a.png`: not relative to the report, so never joined to it. */
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/;

/** Playwright's attachment lines, as evidence; relative paths in them start at the report. */
function attachments(element: XmlElement, report: string): { kind: string; ref: string }[] {
  const dir = posix.dirname(report);
  return element.children
    .filter((child) => child.name === "system-out")
    .flatMap((child) => [...child.text.matchAll(ATTACHMENT)])
    .map((match) => {
      const path = (match[1] as string).trim().replaceAll("\\", "/");
      return {
        kind: "attachment",
        ref: ABSOLUTE.test(path) ? path : posix.normalize(posix.join(dir, path)),
      };
    });
}

/** ISO time in UTC without milliseconds, as casefile writes `at`; `undefined` without a zone. */
function zonedTime(value: string | undefined): string | undefined {
  if (value === undefined || !ZONED.test(value.trim())) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
