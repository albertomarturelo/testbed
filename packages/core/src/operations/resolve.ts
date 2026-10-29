import { z } from "zod";
import { fail, ok } from "../errors.js";
import { caseRef } from "../resolve/resolve.js";
import { CaseRef, findCase, loadWorkspaceCases } from "./cases.js";
import { defineOperation } from "./operation.js";

const ResolveInput = z.strictObject({
  /** The case: a bare id in the current project, or `<project>/TC-NNNN`. */
  ref: CaseRef,
  /** Where a bare id is looked up; filled by the host. Absent: every project. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const ResolveOutput = z.strictObject({
  /** Always qualified: `web/TC-0003`. */
  ref: z.string(),
  path: z.string(),
  /**
   * The Markdown below the frontmatter, without the blank lines around it and
   * ending in a newline. Absent when the case has none.
   */
  body: z.string().optional(),
  /** Every inheritable value with the file it came from, in `origins` order. */
  inherited: z.array(z.strictObject({ field: z.string(), value: z.string(), origin: z.string() })),
  /** The whole resolved case, as the resolver returns it. */
  case: z.record(z.string(), z.unknown()),
});

/**
 * `casefile resolve <ref>`: one case after commons inheritance, with the origin
 * of every inherited value. Read-only. A bare id found in several projects is
 * an error asking for `<project>/TC-NNNN` or `--project`.
 */
export const resolveOperation = defineOperation({
  name: "resolve",
  input: ResolveInput,
  output: ResolveOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/resolve.md",
  subject: "ref",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const target = findCase(workspace, input.ref, input.project);
    if (!target.ok) return target;

    const { path, body } = target.value.case;
    const found = resolved.cases.find((c) => c.path === path);
    if (found === undefined) {
      // It loaded but did not resolve: the resolver's errors say why.
      return fail(...resolved.errors.filter((e) => e.path === path));
    }
    const inherited = Object.entries(found.origins).map(([field, origin]) => ({
      field,
      value: display(valueAt(found, field)),
      origin: origin === found.path ? "(the case)" : origin,
    }));
    const text = documentBody(body);
    return ok({
      ref: caseRef(found),
      path: found.path,
      ...(text === undefined ? {} : { body: text }),
      inherited,
      case: found,
    });
  },
});

/**
 * The body as a reader wants it: the blank line after `---` and trailing blank
 * lines dropped, one final newline (text, so hosts print it as a block).
 */
function documentBody(body: string): string | undefined {
  const text = body.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
  return text === "" ? undefined : `${text}\n`;
}

/** `labels.owner_team`, `preconditions.0`, `automation.eligible` → the value there. */
function valueAt(subject: object, field: string): unknown {
  let current: unknown = subject;
  for (const segment of field.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
