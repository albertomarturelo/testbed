import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inputFields } from "./fields.js";
import { initOperation } from "./init.js";
import { projectAddOperation } from "./project-add.js";
import { validateOperation } from "./validate.js";

describe("inputFields", () => {
  it("describes the built-ins, host inputs included", () => {
    expect(inputFields(initOperation)).toEqual([
      { name: "casefileVersion", kind: "string", multiple: false, required: true, host: "version" },
      { name: "skills", kind: "json", multiple: false, required: false, host: "skills" },
      {
        name: "skillsInto",
        kind: "string",
        multiple: true,
        required: false,
        choices: [".claude/skills", ".agents/skills"],
      },
    ]);
    expect(inputFields(projectAddOperation).map((f) => [f.name, f.required])).toEqual([
      ["name", true],
      ["path", true],
    ]);
    expect(inputFields(validateOperation)).toEqual([
      { name: "project", kind: "string", multiple: false, required: false, host: "project" },
    ]);
  });

  it("maps every shape to a kind, through wrappers and pipes", () => {
    const input = z.strictObject({
      count: z.number().int(),
      ratio: z.number().default(1),
      dry: z.boolean().optional(),
      level: z.enum(["low", "high"]).nullable(),
      ids: z.array(z.number()),
      flags: z.array(z.boolean()),
      pairs: z.array(z.object({ a: z.string() })),
      options: z.object({ a: z.string() }).optional(),
      piped: z.string().transform((s) => s.length),
      kept: z.string().readonly().catch("x"),
      unknown: z.unknown(),
      bogus: z.string().meta({ host: "not-a-host-input" }),
    });
    const byName = Object.fromEntries(inputFields({ input }).map((f) => [f.name, f]));
    expect(byName.count).toEqual({
      name: "count",
      kind: "number",
      multiple: false,
      required: true,
    });
    expect(byName.ratio).toMatchObject({ kind: "number", required: false });
    expect(byName.dry).toMatchObject({ kind: "boolean", required: false });
    expect(byName.level).toMatchObject({
      kind: "string",
      choices: ["low", "high"],
      required: true,
    });
    expect(byName.ids).toMatchObject({ kind: "number", multiple: true });
    expect(byName.flags).toMatchObject({ kind: "json", multiple: false });
    expect(byName.pairs).toMatchObject({ kind: "json", multiple: false });
    expect(byName.options).toMatchObject({ kind: "json", required: false });
    expect(byName.piped).toMatchObject({ kind: "string" });
    expect(byName.kept).toMatchObject({ kind: "string", required: false });
    expect(byName.unknown).toMatchObject({ kind: "json", required: false });
    expect(byName.bogus).not.toHaveProperty("host");
  });

  it("returns no fields for a non-object input", () => {
    expect(inputFields({ input: z.string() })).toEqual([]);
  });
});
