import type { CasefileError } from "../errors.js";
import { checkQueryContext } from "../query/evaluate.js";
import { parseQuery } from "../query/parse.js";
import type { Dashboard } from "../schema/index.js";

/**
 * What the schema cannot say about a dashboard (ADR dashboards-as-files §4, §7):
 * widget ids are unique, every query parses and reads `milestone.*` only when
 * the widget names a milestone, and that milestone is declared. Pure: `save`
 * refuses a dashboard with any of these, `validate` reports them on the file.
 * `field` is the path inside the dashboard (`widgets.2.query`).
 */
export function dashboardProblems(
  dashboard: Dashboard,
  milestones: { has(slug: string): boolean },
): CasefileError[] {
  const problems: CasefileError[] = [];
  const firstWithId = new Map<string, number>();
  for (const [index, widget] of dashboard.widgets.entries()) {
    const at = `widgets.${index}`;
    const first = firstWithId.get(widget.id);
    if (first === undefined) firstWithId.set(widget.id, index);
    else {
      problems.push({
        code: "dashboard.duplicate_widget",
        field: `${at}.id`,
        message: `widget id '${widget.id}' is already used by widgets.${first}`,
      });
    }
    if (widget.milestone !== undefined && !milestones.has(widget.milestone)) {
      problems.push({
        code: "dashboard.unknown_milestone",
        field: `${at}.milestone`,
        message: `widget '${widget.id}' names milestone '${widget.milestone}', which the project does not declare`,
      });
    }
    if (widget.query === undefined) continue;
    const variables = { name: "milestone", build: "build" };
    const parsed = parseQuery(widget.query);
    const checked = !parsed.ok
      ? parsed
      : checkQueryContext(
          parsed.value,
          widget.milestone === undefined ? {} : { milestone: variables, release: variables },
        );
    if (checked.ok) continue;
    for (const error of checked.errors) {
      problems.push({
        code: "dashboard.invalid_query",
        field: `${at}.query`,
        // The column is in the query text, not the file: said in words.
        message: `widget '${widget.id}': ${error.message}${
          error.column === undefined ? "" : ` (query column ${error.column})`
        }`,
      });
    }
  }
  return problems;
}
