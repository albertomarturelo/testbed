import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { type CaseRuns, call, type Resolved, type Result } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { AutomationBadge, RunBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRoute } from "@/route";

type Step = { do?: string; expect?: string };
type HistoryEntry = { at?: string; by?: string; via?: string; event?: string };

/** One case after inheritance (`resolve`), with where each inherited value came from. */
export function CaseDetail({ caseRef }: { caseRef: string }) {
  const [result, setResult] = useState<Result<Resolved> | null>(null);
  useEffect(() => {
    let current = true;
    setResult(null);
    call<Resolved>("resolve", { ref: caseRef }).then((r) => current && setResult(r));
    return () => {
      current = false;
    };
  }, [caseRef]);

  const project = caseRef.split("/")[0];
  const back = (
    <a
      href={formatRoute({ view: "cases", project })}
      className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Cases
    </a>
  );
  if (result === null) return <Skeleton className="h-64 w-full" />;
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <ErrorList errors={result.errors} />
      </div>
    );
  }

  const { value } = result;
  const c = value.case;
  const automation = c.automation as { status: string; ref?: string; eligible: boolean };
  const steps = Array.isArray(c.steps) ? (c.steps as Step[]) : [];
  const preconditions = Array.isArray(c.preconditions) ? (c.preconditions as string[]) : [];
  const history = Array.isArray(c.history) ? (c.history as HistoryEntry[]) : [];

  return (
    <div className="flex flex-col gap-4">
      {back}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-muted-foreground text-sm">{value.ref}</span>
          <Badge variant="outline">{String(c.state)}</Badge>
          <Badge variant="secondary">{String(c.priority)}</Badge>
          <AutomationBadge status={automation.status} />
        </div>
        <h1 className="font-semibold text-2xl tracking-tight">{String(c.title)}</h1>
        <p className="font-mono text-muted-foreground text-xs">{value.path}</p>
        {automation.ref === undefined ? null : (
          <p className="text-sm">
            Automated by <span className="font-mono text-xs">{automation.ref}</span>
          </p>
        )}
      </div>

      <RunsCard caseRef={caseRef} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
            {preconditions.length === 0 ? null : (
              <CardDescription>Preconditions: {preconditions.join(" · ")}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {steps.length === 0 ? (
              <p className="text-muted-foreground text-sm">No steps.</p>
            ) : (
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
                {steps.map((step, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: steps are ordered by position
                  <li key={i}>
                    <p>{step.do}</p>
                    {step.expect === undefined ? null : (
                      <p className="text-muted-foreground">→ {step.expect}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inherited values</CardTitle>
            <CardDescription>Each value and the file it comes from.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Origin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {value.inherited.map((row) => (
                  <TableRow key={row.field}>
                    <TableCell className="font-mono text-xs">{row.field}</TableCell>
                    <TableCell>{row.value}</TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {row.origin}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {history.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {history.map((entry, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: history is append-only
                <li key={i} className="flex flex-wrap gap-x-3">
                  <span className="font-medium">{entry.event}</span>
                  <span className="text-muted-foreground">{entry.at}</span>
                  <span>{entry.by}</span>
                  <span className="font-mono text-muted-foreground text-xs">{entry.via}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** The case's run events (`runs`), newest first, each with why it ended as it did. */
function RunsCard({ caseRef }: { caseRef: string }) {
  const [result, setResult] = useState<Result<CaseRuns> | null>(null);
  useEffect(() => {
    let current = true;
    setResult(null);
    call<CaseRuns>("runs", { ref: caseRef }).then((r) => current && setResult(r));
    return () => {
      current = false;
    };
  }, [caseRef]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Runs</CardTitle>
        <CardDescription>Newest first, from the project&apos;s run files.</CardDescription>
      </CardHeader>
      <CardContent>
        {result === null ? (
          <Skeleton className="h-16 w-full" />
        ) : !result.ok ? (
          <ErrorList errors={result.errors} />
        ) : result.value.runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">Never ran.</p>
        ) : (
          <ol className="flex flex-col divide-y">
            {result.value.runs.map((run, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: run files are append-only; events have no id
              <li key={i} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <RunBadge status={run.status} />
                  <time dateTime={run.at} className="text-muted-foreground">
                    {run.at}
                  </time>
                  <span title={run.path}>
                    run <span className="font-mono text-xs">{run.run_id}</span>
                  </span>
                  <span className="font-mono text-xs">{run.executor}</span>
                  {run.duration_ms === undefined ? null : (
                    <span className="text-muted-foreground">{seconds(run.duration_ms)}</span>
                  )}
                  {(["env", "build", "release"] as const).map((field) =>
                    run[field] === undefined ? null : (
                      <Badge key={field} variant="outline" title={field}>
                        {run[field]}
                      </Badge>
                    ),
                  )}
                </div>
                {run.note === undefined ? null : (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
                    {run.note}
                  </pre>
                )}
                {(run.evidence ?? []).length === 0 ? null : (
                  <ul className="flex flex-col gap-0.5 text-xs">
                    {(run.evidence ?? []).map((item, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: evidence keeps report order
                      <li key={j} className="flex flex-wrap gap-x-2">
                        <span className="text-muted-foreground">{item.kind}</span>
                        <span className="break-all font-mono">{item.ref}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** `30018` → `30.0 s`. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
