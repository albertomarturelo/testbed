import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workflowProblems } from "../ci-workflow.fixture.js";
import {
  parseCaseFile,
  parseCommonFile,
  parseConfigFile,
  parseDashboardFile,
  parseMilestoneFile,
  parsePolicyFile,
  parseRunFile,
} from "../load/parse.js";
import { CORE_SPECS_DIR } from "./spec.js";

/**
 * SPEC examples that name a file after the fence language (```yaml casefile.yaml)
 * must parse as that file: a SPEC cannot drift from the schemas (#5).
 */
const PARSERS: [RegExp, (path: string, text: string) => { ok: boolean; problems?: string[] }][] = [
  [/^casefile\.yaml$/, parseConfigFile],
  [/_common\.yaml$/, parseCommonFile],
  [/^TC-\d{4,}\.md$/, parseCaseFile],
  [/(?:^|\/)context\/milestones\/[^/]+\.yaml$/, parseMilestoneFile],
  [/(?:^|\/)context\/dashboards\/[^/]+\.yaml$/, parseDashboardFile],
  [/^dashboard\.json$/, parseDashboardFile],
  [/(?:^|\/)context\/releases\/policy\.yaml$/, parsePolicyFile],
  [/\.jsonl$/, (path, text) => ({ ok: parseRunFile(path, text).errors.length === 0 })],
  // GitHub Actions workflows (`casefile spec ci`): the rules of ADR ci-commits-run-files.
  [/\.yml$/, (_, text) => ({ ok: true, problems: workflowProblems(text) })],
];

const files = (await readdir(CORE_SPECS_DIR)).filter((f) => f.endsWith(".md"));
const examples = (
  await Promise.all(
    files.map(async (spec) => {
      const text = await readFile(join(CORE_SPECS_DIR, spec), "utf8");
      return [...text.matchAll(/^```\w+ (\S+)\n([\s\S]*?)^```$/gm)].map(([, name, body]) => ({
        spec,
        name: name as string,
        body: body as string,
      }));
    }),
  )
).flat();

describe("SPEC examples", () => {
  it("include the setup, cover and review examples", () => {
    const named = examples.map((e) => `${e.spec}:${e.name}`);
    expect(named).toContain("setup.md:casefile.yaml");
    expect(named).toContain("setup.md:_common.yaml");
    expect(named).toContain("cover.md:TC-0003.md");
    expect(named).toContain("review.md:TC-0003.md");
    expect(named).toContain("ingest.md:9137.jsonl");
    expect(named).toContain("dashboard.md:context/dashboards/overview.yaml");
    expect(named).toContain("dashboard.md:dashboard.json");
    expect(named).toContain("ci.md:tests.yml");
    expect(named).toContain("ci.md:casefile-validate.yml");
  });

  it.each(examples.map((e) => [`${e.spec} ${e.name}`, e] as const))("%s parses", (_, e) => {
    const parse = PARSERS.find(([pattern]) => pattern.test(e.name))?.[1];
    expect(parse, `no parser for example file ${e.name}`).toBeDefined();
    const parsed = parse?.(e.name, e.body);
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed?.problems ?? []).toEqual([]);
  });
});

describe("the workflow check", () => {
  const body = (name: string) => examples.find((e) => e.name === name)?.body ?? "";
  const tests = body("tests.yml");
  const validate = body("casefile-validate.yml");

  it.each([
    ["no paths-ignore", tests.replace(/^ {4}paths-ignore:.*\n/m, ""), "the tests must ignore"],
    [
      "the tested commit checked out",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expressions
      tests.replace("ref: ${{ github.ref_name }}", "ref: ${{ github.sha }}"),
      "branch tip",
    ],
    ["records pull requests", tests.replace(" && github.event_name == 'push'", ""), "pull request"],
    ["skips failed tests", tests.replace("always() && ", ""), "when the tests failed"],
    [
      "commits everything staged",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell array, not a template
      tests.replace('/message" -- "${files[@]}"', '/message"'),
      "-- <paths>",
    ],
    [
      "merges on rejection",
      tests.replace("git reset --hard FETCH_HEAD", "git pull --rebase"),
      "never resolve",
    ],
    [
      "a concurrency group",
      tests.replace("  record:\n", "  record:\n    concurrency: record\n"),
      "concurrency",
    ],
    [
      "validate skipping run files",
      validate.replace("branches: [main", 'paths-ignore: ["**/.runs/**"]\n    branches: [main'),
      "validate must not skip",
    ],
  ])("finds a template with %s", (_, text, problem) => {
    expect([tests, validate], "the replacement changed nothing").not.toContain(text);
    expect(workflowProblems(text).join("\n")).toContain(problem);
  });
});
