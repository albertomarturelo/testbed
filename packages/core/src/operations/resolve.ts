import { z } from "zod";
import { fail, ok } from "../errors.js";
import { caseRef } from "../resolve/resolve.js";
import { loadWorkspaceCases, selectProject } from "./cases.js";
import { defineOperation } from "./operation.js";

/** `TC-0003`, or qualified with its project: `web/TC-0003` (ADR workspace-and-projects §5). */
const CaseRef = z
  .string()
  .regex(/^(?:([a-z][a-z0-9-]*)\/)?(TC-[0-9]{4,})$/, "TC-NNNN or <project>/TC-NNNN");

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
    const [, qualifier, id] = /^(?:([^/]+)\/)?(.+)$/.exec(input.ref) as RegExpExecArray;
    const scope = selectProject(workspace, qualifier ?? input.project);
    if (!scope.ok) return scope;

    const candidates = workspace.projects
      .filter((p) => scope.value === null || p === scope.value)
      .flatMap((p) => p.cases.filter((c) => c.file.id === id).map((c) => ({ project: p.name, c })));
    if (candidates.length === 0) {
      const where = scope.value === null ? "the workspace" : `project '${scope.value.name}'`;
      return fail({ code: "case.unknown", field: "ref", message: `no case ${id} in ${where}` });
    }
    if (candidates.length > 1) {
      const refs = candidates.map(({ project }) => `${project}/${id}`);
      return fail({
        code: "case.ambiguous",
        field: "ref",
        message: `${id} is a case in several projects (${refs.join(", ")}): use ${refs[0]} or --project`,
      });
    }

    const { path } = (candidates[0] as (typeof candidates)[number]).c;
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
    return ok({ ref: caseRef(found), path: found.path, inherited, case: found });
  },
});

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
