import type { CaseRow } from "@/api";
import { compareFeatures } from "@/components/FeatureTree";
import { AutomationBadge, RunBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRoute } from "@/route";

/**
 * Columns the human can do without on a narrow list: the feature tree, the case
 * page and the query box show them. Case, title, automation and last run stay.
 */
const WIDE_ONLY = "hidden @4xl:table-cell";

/**
 * The cases of the selected project and feature, one row each. `grouped` lists
 * them under one heading per feature, in tree order, like a table of contents
 * (#112); the heading links to the feature. There is no Feature column: flat,
 * the list is one leaf feature and every row would repeat it.
 * `showAutomation` and `showLastRun` are off when the viewer hides them, and
 * `showLastRun` also when the project has never run (ADR authoring-loop-first:
 * cases kept as documentation are complete without runs).
 */
export function CaseList({
  rows,
  grouped = false,
  project,
  state,
  emptyText = "No cases here yet.",
  showAutomation = true,
  showLastRun = true,
}: {
  rows: readonly CaseRow[];
  grouped?: boolean;
  /** The listed project, for the group headings' links: the same as the feature tree's. */
  project?: string;
  /** The list's state filter (#87): the group headings' links keep it. */
  state?: string;
  emptyText?: string;
  showAutomation?: boolean;
  showLastRun?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-muted-foreground text-sm">{emptyText}</p>;
  }
  // Rows of one project need only the case id; across projects the ref tells them apart.
  const oneProject = rows.every((row) => row.project === rows[0]?.project);
  const columns = 4 + Number(showAutomation) + Number(showLastRun);
  const caseRow = (row: CaseRow) => (
    <TableRow key={row.ref}>
      <TableCell className="font-mono text-xs">
        <a
          className="hover:underline"
          href={formatRoute({ view: "case", ref: row.ref })}
          title={row.ref}
        >
          {oneProject ? row.ref.slice(row.project.length + 1) : row.ref}
        </a>
      </TableCell>
      {/* w-full + max-w-0: the title takes what the other columns leave; it wraps to two lines, then clamps. */}
      <TableCell className="w-full max-w-0 whitespace-normal">
        <a
          className="line-clamp-2 break-words hover:underline"
          href={formatRoute({ view: "case", ref: row.ref })}
          title={row.title}
        >
          {row.title}
        </a>
      </TableCell>
      <TableCell className={WIDE_ONLY}>
        <Badge variant="outline">{row.state}</Badge>
      </TableCell>
      <TableCell className={WIDE_ONLY}>{row.priority}</TableCell>
      {showAutomation ? (
        <TableCell>
          <AutomationBadge
            automation={{
              status: row.automation,
              ref: row.automation_ref,
              eligible: row.eligible,
            }}
          />
        </TableCell>
      ) : null}
      {showLastRun ? (
        <TableCell>
          <div className="flex flex-col items-start gap-0.5 @4xl:flex-row @4xl:items-center @4xl:gap-2">
            <RunBadge status={row.last_run} />
            {row.last_run_at === null ? null : (
              <span className="text-muted-foreground text-xs">{formatDate(row.last_run_at)}</span>
            )}
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
  // The container, not the viewport, decides: the feature tree takes part of the width.
  return (
    <div className="@container">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className={WIDE_ONLY}>State</TableHead>
            <TableHead className={WIDE_ONLY}>Priority</TableHead>
            {showAutomation ? <TableHead>Automation</TableHead> : null}
            {showLastRun ? <TableHead>Last run</TableHead> : null}
          </TableRow>
        </TableHeader>
        {grouped ? (
          byFeature(rows).map(([feature, group]) => (
            // One row group per feature: its heading is a `rowgroup` header, so the
            // columns stay aligned across groups and a screen reader knows the scope.
            <TableBody key={feature}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <th
                  scope="rowgroup"
                  colSpan={columns}
                  className="px-2 py-1.5 text-left font-medium"
                >
                  <a
                    className="hover:underline"
                    href={formatRoute({ view: "cases", project, feature, state })}
                  >
                    {feature}
                  </a>{" "}
                  <span className="font-normal text-muted-foreground">· {group.length}</span>
                </th>
              </TableRow>
              {group.map(caseRow)}
            </TableBody>
          ))
        ) : (
          <TableBody>{rows.map(caseRow)}</TableBody>
        )}
      </Table>
    </div>
  );
}

/** The rows per feature, features in tree order; rows keep their order within a feature. */
function byFeature(rows: readonly CaseRow[]): [string, CaseRow[]][] {
  const groups = new Map<string, CaseRow[]>();
  for (const row of rows) {
    const group = groups.get(row.feature);
    if (group === undefined) groups.set(row.feature, [row]);
    else group.push(row);
  }
  return [...groups].sort(([a], [b]) => compareFeatures(a, b));
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
