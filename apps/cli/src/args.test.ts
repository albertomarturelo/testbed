import { type Operation, ok } from "@casefile/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  findCwd,
  kebab,
  matchCommand,
  parseCommandArgs,
  parseGlobalArgs,
  toCommand,
} from "./args.js";

const op = (name: string, input: z.ZodType, subject?: string): Operation => ({
  name,
  input,
  output: z.unknown(),
  actor: ["human"],
  writes: [],
  spec: `specs/${name}.md`,
  ...(subject === undefined ? {} : { subject }),
  run: async (value) => ok(value),
});

const command = (operation: Operation) => {
  const result = toCommand(operation);
  if (!result.ok) throw new Error(result.errors[0]?.message);
  return result.value;
};

describe("toCommand", () => {
  it("splits fields into subject, flags and host inputs", () => {
    const c = command(
      op(
        "id-next",
        z.object({
          id: z.string(),
          dryRun: z.boolean(),
          project: z.string().meta({ host: "project" }),
        }),
        "id",
      ),
    );
    expect(c.words).toEqual(["id", "next"]);
    expect(c.subject?.name).toBe("id");
    expect(c.flags.map((f) => f.name)).toEqual(["dryRun"]);
    expect(c.hosts.map((f) => f.host)).toEqual(["project"]);
  });

  it("refuses an input field that clashes with a global flag", () => {
    expect(toCommand(op("x", z.object({ cwd: z.string(), json: z.boolean() })))).toMatchObject({
      ok: false,
      errors: [
        { code: "cli.flag_conflict", field: "cwd" },
        { code: "cli.flag_conflict", field: "json" },
      ],
    });
  });
});

describe("matchCommand", () => {
  const commands = [op("project", z.object({})), op("project-add", z.object({}))].map(command);

  it("prefers the longest name", () => {
    expect(matchCommand(commands, ["project", "add", "web"])).toMatchObject({
      command: { words: ["project", "add"] },
      rest: ["web"],
    });
    expect(matchCommand(commands, ["project", "list"])).toMatchObject({ rest: ["list"] });
    expect(matchCommand(commands, ["frob"])).toBeNull();
  });
});

describe("parseCommandArgs", () => {
  const c = command(
    op(
      "go",
      z.object({
        target: z.number(),
        count: z.number().optional(),
        tags: z.array(z.number()).optional(),
        options: z.object({ a: z.string() }).optional(),
        quiet: z.boolean().optional(),
      }),
      "target",
    ),
  );

  it("converts the subject and flags by kind", () => {
    const parsed = parseCommandArgs(c, [
      "7",
      "--count",
      "3",
      "--tags",
      "1",
      "--tags",
      "2",
      "--options",
      '{"a":"b"}',
      "--quiet",
      "--json",
      "--project",
      "web",
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        globals: { json: true, project: "web" },
        input: { target: 7, count: 3, tags: [1, 2], options: { a: "b" }, quiet: true },
      },
    });
  });

  it("leaves a non-number as text for the schema to reject", () => {
    expect(parseCommandArgs(c, ["seven", "--count", " "])).toMatchObject({
      ok: true,
      value: { input: { target: "seven", count: " " } },
    });
  });

  it("reports invalid JSON and unknown flags as usage errors", () => {
    expect(parseCommandArgs(c, ["--options", "{"])).toEqual({
      ok: false,
      errors: [{ code: "cli.usage", message: "--options takes JSON" }],
    });
    expect(parseCommandArgs(c, ["--nope"])).toMatchObject({
      ok: false,
      errors: [{ code: "cli.usage" }],
    });
    expect(parseCommandArgs(command(op("bare", z.object({}))), ["x"])).toMatchObject({
      ok: false,
      errors: [{ message: "unexpected argument 'x'; only the subject is positional" }],
    });
  });
});

describe("globals", () => {
  it("finds --cwd before the command is known", () => {
    expect(findCwd(["validate", "--cwd", "a"])).toBe("a");
    expect(findCwd(["--cwd=b", "validate"])).toBe("b");
    expect(findCwd(["query", "--", "--cwd", "c"])).toBeUndefined();
    expect(findCwd(["validate"])).toBeUndefined();
  });

  it("parses host commands with only the global options", () => {
    expect(parseGlobalArgs(["project", "add", "--cwd", "x", "--json"])).toEqual(
      ok(["project", "add"]),
    );
    expect(parseGlobalArgs(["--frob"])).toMatchObject({
      ok: false,
      errors: [{ code: "cli.usage" }],
    });
  });

  it("kebab-cases camelCase field names", () => {
    expect(kebab("skillsInto")).toBe("skills-into");
    expect(kebab("path")).toBe("path");
  });
});
