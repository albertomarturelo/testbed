import { z } from "zod";
import { fail, ok } from "../errors.js";
import { queryCases } from "../query/evaluate.js";
import { caseRef } from "../resolve/resolve.js";
import { loadWorkspaceCases, selectProject } from "./cases.js";
import { defineOperation } from "./operation.js";

const QueryInput = z.strictObject({
  /** A query in the DSL (`casefile spec query`; grammar: `casefile spec query-grammar`). */
  query: z.string().min(1),
  /** Only this project's cases; filled by the host. Absent: every project. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const QueryOutput = z.strictObject({
  count: z.number().int(),
  /** Matching cases in project and path order, one flat row each. */
  cases: z.array(
    z.strictObject({ ref: z.string(), state: z.string(), priority: z.string(), title: z.string() }),
  ),
  /** Cases that did not resolve (a required field is missing) and so cannot match. */
  unresolved: z.number().int(),
});

/**
 * `casefile query "<query>"` (ADR single-query-dsl): the resolved cases a query
 * selects. Read-only. DSL errors carry their `column` and `field: "query"`, so
 * hosts can point at the spot in the query text.
 */
export const queryOperation = defineOperation({
  name: "query",
  input: QueryInput,
  output: QueryOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/query.md",
  subject: "query",
  async run(input, context) {
    const loaded = await loadWorkspaceCases(context.root);
    if (!loaded.ok) return loaded;
    const { workspace, resolved } = loaded.value;
    const scope = selectProject(workspace, input.project);
    if (!scope.ok) return scope;
    const name = scope.value?.name;
    const inScope = <T extends { project: string }>(items: readonly T[]) =>
      items.filter((item) => name === undefined || item.project === name);

    const matched = queryCases(input.query, inScope(resolved.cases));
    if (!matched.ok) return fail(...matched.errors.map((e) => ({ ...e, field: "query" })));
    const loadedCount = workspace.projects
      .filter((p) => name === undefined || p.name === name)
      .reduce((sum, p) => sum + p.cases.length, 0);
    return ok({
      count: matched.value.length,
      cases: matched.value.map((c) => ({
        ref: caseRef(c),
        state: c.state,
        priority: c.priority,
        title: c.title,
      })),
      unresolved: loadedCount - inScope(resolved.cases).length,
    });
  },
});
