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
import { formatRoute } from "@/route";

/** The cases of the selected project and feature, one row each. */
export function CaseList({ rows }: { rows: readonly CaseRow[] }) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-muted-foreground text-sm">No cases here yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-36">Case</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Feature</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Automation</TableHead>
          <TableHead>Last run</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.ref}>
            <TableCell className="font-mono text-xs">
              <a className="hover:underline" href={formatRoute({ view: "case", ref: row.ref })}>
                {row.ref}
              </a>
            </TableCell>
            <TableCell className="max-w-md truncate">
              <a className="hover:underline" href={formatRoute({ view: "case", ref: row.ref })}>
                {row.title}
              </a>
            </TableCell>
            <TableCell className="text-muted-foreground">{row.feature}</TableCell>
            <TableCell>
              <Badge variant="outline">{row.state}</Badge>
            </TableCell>
            <TableCell>{row.priority}</TableCell>
            <TableCell>
              <AutomationBadge status={row.automation} />
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
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
  );
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
