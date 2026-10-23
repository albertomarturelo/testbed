import type { CaseRow } from "@/api";
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
import { cn } from "@/lib/utils";
import { formatRoute } from "@/route";

/**
 * Columns the human can do without on a narrow list: the feature tree, the case
 * page and the query box show them. Case, title, automation and last run stay.
 */
const WIDE_ONLY = "hidden @4xl:table-cell";

/**
 * The cases of the selected project and feature, one row each. `showFeature`
 * is off when a leaf feature is selected: every row would repeat it.
 */
export function CaseList({
  rows,
  showFeature = true,
}: {
  rows: readonly CaseRow[];
  showFeature?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-muted-foreground text-sm">No cases here yet.</p>;
  }
  // Rows of one project need only the case id; across projects the ref tells them apart.
  const oneProject = rows.every((row) => row.project === rows[0]?.project);
  // The container, not the viewport, decides: the feature tree takes part of the width.
  return (
    <div className="@container">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case</TableHead>
            <TableHead>Title</TableHead>
            {showFeature ? <TableHead className={WIDE_ONLY}>Feature</TableHead> : null}
            <TableHead className={WIDE_ONLY}>State</TableHead>
            <TableHead className={WIDE_ONLY}>Priority</TableHead>
            <TableHead>Automation</TableHead>
            <TableHead>Last run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
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
              {showFeature ? (
                <TableCell className={cn(WIDE_ONLY, "text-muted-foreground")}>
                  {row.feature}
                </TableCell>
              ) : null}
              <TableCell className={WIDE_ONLY}>
                <Badge variant="outline">{row.state}</Badge>
              </TableCell>
              <TableCell className={WIDE_ONLY}>{row.priority}</TableCell>
              <TableCell>
                <AutomationBadge
                  automation={{
                    status: row.automation,
                    ref: row.automation_ref,
                    eligible: row.eligible,
                  }}
                />
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-0.5 @4xl:flex-row @4xl:items-center @4xl:gap-2">
                  <RunBadge status={row.last_run} />
                  {row.last_run_at === null ? null : (
                    <span className="text-muted-foreground text-xs">
                      {formatDate(row.last_run_at)}
                    </span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
