import { Archive, Check, ClipboardCheck, Pencil } from "lucide-react";
import { Fragment, useEffect, useId, useState } from "react";
import {
  type CasefileError,
  type CaseRuns,
  call,
  type Recorded,
  type Resolved,
  type Result,
  type Reviewed,
} from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { AutomationBadge, RunBadge } from "@/components/StatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CaseEditor } from "@/views/CaseEditor";
import { RunRecorder } from "@/views/RunRecorder";

/** A write whose commit the page names: an edit, approve or retire, or the one that created the case. */
type Written = Pick<Reviewed, "change" | "commit">;
type Step = { do?: string; expect?: string };
type HistoryEntry = {
  at?: string;
  by?: string;
  via?: string;
  event?: string;
  change?: string;
  commit?: string | null;
};

/** The state moves the page offers (`casefile spec review`, Transitions); never automated or flaky. */
const MOVES: Record<string, { to: string; label: string; says: string }> = {
  draft: { to: "active", label: "Approve", says: "It moves from draft to active." },
  in_review: { to: "active", label: "Approve", says: "It moves from in review to active." },
  active: {
    to: "retired",
    label: "Retire",
    says: "It moves from active to retired. It can be reopened later as a draft.",
  },
};

/**
 * One case after inheritance (`resolve`), read as a test-case document (#86,
 * ADR authoring-loop-first §4): title and status, the body, preconditions,
 * data, numbered steps, references; then history, runs, and the inherited
 * values with the file each came from.
 */
export function CaseDetail({
  caseRef,
  written,
  onWritten,
}: {
  caseRef: string;
  /** The write that just created this case (#94): its page names the commit, as after an edit. */
  written?: Written;
  /** After an edit, a move or a recorded result: the list behind reads the workspace again (#146). */
  onWritten?: () => void;
}) {
  const [result, setResult] = useState<Result<Resolved> | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<Written | null>(written ?? null);
  const [actionErrors, setActionErrors] = useState<CasefileError[]>([]);
  useEffect(() => {
    let current = true;
    setResult(null);
    setEditing(false);
    setSaved(written ?? null);
    setActionErrors([]);
    call<Resolved>("resolve", { ref: caseRef }).then((r) => current && setResult(r));
    return () => {
      current = false;
    };
  }, [caseRef, written]);

  if (result === null) return <Skeleton className="h-64 w-full" />;
  if (!result.ok) return <ErrorList errors={result.errors} />;

  const { value } = result;
  const c = value.case;
  /** After a write: say what was committed and read the case again from its file. */
  const done = async (reviewed: Reviewed) => {
    setEditing(false);
    setActionErrors([]);
    setSaved(reviewed);
    setResult(await call<Resolved>("resolve", { ref: caseRef }));
    onWritten?.();
  };
  const base = (Array.isArray(c.history) ? (c.history as HistoryEntry[]) : []).at(-1)?.change;
  const move = MOVES[String(c.state)];
  const automation = c.automation as { status: string; ref?: string; eligible: boolean };
  const steps = Array.isArray(c.steps) ? (c.steps as Step[]) : [];
  const preconditions = Array.isArray(c.preconditions) ? (c.preconditions as string[]) : [];
  const data = isRecord(c.data) ? Object.entries(c.data) : [];
  const acceptance = Array.isArray(c.acceptance_ref) ? (c.acceptance_ref as string[]) : [];
  const workItems = Array.isArray(c.work_items) ? (c.work_items as string[]) : [];
  const history = Array.isArray(c.history) ? (c.history as HistoryEntry[]) : [];
  // Core already drops the blank lines around it; keep a first line's indentation.
  const body = value.body?.trimEnd() ?? "";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        {/* Reading order: the title, then where the case stands. */}
        <h1 className="font-semibold text-2xl tracking-tight">{String(c.title)}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-muted-foreground text-sm">{value.ref}</span>
          <Badge variant="outline">{String(c.state)}</Badge>
          <Badge variant="secondary">{String(c.priority)}</Badge>
          <AutomationBadge automation={{ ...automation, ref: automation.ref ?? null }} />
        </div>
        <p className="font-mono text-muted-foreground text-xs">{value.path}</p>
        {automation.ref === undefined ? null : (
          <p className="text-sm">
            Automated by <span className="font-mono text-xs">{automation.ref}</span>
          </p>
        )}
        {editing ? null : (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSaved(null);
                setActionErrors([]);
                setEditing(true);
              }}
            >
              <Pencil /> Edit
            </Button>
            {move === undefined ? null : (
              <MoveButton
                caseRef={value.ref}
                title={String(c.title)}
                move={move}
                base={base}
                onDone={done}
                onFailed={(errors) => {
                  setSaved(null);
                  setActionErrors(errors);
                }}
              />
            )}
          </div>
        )}
        {saved === null ? null : (
          <p role="status" className="text-sm">
            Committed{" "}
            <span className="font-mono text-xs" title={saved.commit.sha}>
              {saved.commit.sha.slice(0, 7)}
            </span>
            : {saved.commit.message.split("\n")[0]}
          </p>
        )}
      </header>

      {actionErrors.length === 0 ? null : <ErrorList errors={actionErrors} />}

      {editing ? (
        <CaseEditor resolved={value} onSaved={done} onCancel={() => setEditing(false)} />
      ) : (
        <Card className="min-w-0">
          <CardContent className="flex flex-col gap-6">
            {body === "" ? null : (
              // The body is Markdown kept as text: casefile shows it as written, it does not render it.
              <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">
                {body}
              </p>
            )}
            {preconditions.length === 0 ? null : (
              <Section title="Preconditions">
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {preconditions.map((item, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: preconditions are ordered by position
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}
            {data.length === 0 ? null : (
              <Section title="Data">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {data.map(([key, item]) => (
                    <Fragment key={key}>
                      <dt className="font-mono text-muted-foreground text-xs leading-5">{key}</dt>
                      <dd className="min-w-0 break-words">
                        {typeof item === "string" ? item : JSON.stringify(item)}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </Section>
            )}
            <Section title="Steps">
              {steps.length === 0 ? (
                <p className="text-muted-foreground text-sm">No steps.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Expected result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {steps.map((step, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: steps are ordered by position
                      <TableRow key={i} className="align-top">
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="w-1/2 whitespace-normal break-words">
                          {step.do}
                        </TableCell>
                        <TableCell className="w-1/2 whitespace-normal break-words">
                          {step.expect ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
            {acceptance.length === 0 && workItems.length === 0 ? null : (
              <Section title="References">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {acceptance.length === 0 ? null : (
                    <>
                      <dt className="text-muted-foreground">Acceptance criteria</dt>
                      <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                        {acceptance.map((ref, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: a ref may be listed twice
                          <Reference key={i} text={ref} />
                        ))}
                      </dd>
                    </>
                  )}
                  {workItems.length === 0 ? null : (
                    <>
                      <dt className="text-muted-foreground">Work items</dt>
                      <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                        {workItems.map((item, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: an item may be listed twice
                          <Reference key={i} text={item} prefixed />
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
              </Section>
            )}
          </CardContent>
        </Card>
      )}

      {history.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {history.map((entry, i) => {
                // Core derives `commit` from `change` once its git lookup lands (#51);
                // until then the page knows the commit of the write it just made.
                const commit =
                  entry.commit ??
                  (saved !== null && entry.change === saved.change ? saved.commit.sha : null);
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: history is append-only
                  <li key={i} className="flex flex-wrap gap-x-3">
                    <span className="font-medium">{entry.event}</span>
                    <span className="text-muted-foreground">{entry.at}</span>
                    <span>{entry.by}</span>
                    <span className="font-mono text-muted-foreground text-xs">{entry.via}</span>
                    {commit ? (
                      <span className="font-mono text-xs" title={commit}>
                        {commit.slice(0, 7)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <RunsCard
        caseRef={caseRef}
        // A run changes no case file, but automation is derived from runs: read
        // it again, so the badge is what core says (a human run proves nothing).
        onRecorded={async () => {
          setResult(await call<Resolved>("resolve", { ref: caseRef }));
          onWritten?.();
        }}
      />

      <Card className="min-w-0">
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
                  <TableCell className="whitespace-normal break-words">{row.value}</TableCell>
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
  );
}

/** A titled part of the case document; the title is its heading. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="font-semibold text-sm">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * An acceptance ref or a work item: a link when it is an http(s) URL, or, for a
 * prefixed work item (`issue:https://…`), when the part after the kind is one.
 * Anything else stays text: repo text never becomes another kind of link (CONVENTIONS 9).
 */
function Reference({ text, prefixed = false }: { text: string; prefixed?: boolean }) {
  const whole = webUrl(text);
  if (whole !== null) return <ExternalLink href={whole}>{text}</ExternalLink>;
  const colon = prefixed ? text.indexOf(":") : -1;
  const rest = colon > 0 ? webUrl(text.slice(colon + 1)) : null;
  if (rest === null) return <span className="font-mono text-xs leading-5">{text}</span>;
  return (
    <span className="min-w-0">
      <span className="font-mono text-muted-foreground text-xs">{text.slice(0, colon)}:</span>
      <ExternalLink href={rest}>{text.slice(colon + 1)}</ExternalLink>
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="break-all text-primary underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  );
}

/** The text as a URL when it is an absolute http(s) one, else null. */
function webUrl(text: string): string | null {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Approve or retire: one `review` call with `to`, after the QA confirms it. */
function MoveButton({
  caseRef,
  title,
  move,
  base,
  onDone,
  onFailed,
}: {
  caseRef: string;
  title: string;
  move: { to: string; label: string; says: string };
  base: string | undefined;
  onDone: (reviewed: Reviewed) => void;
  onFailed: (errors: CasefileError[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const result = await call<Reviewed>("review", {
      ref: caseRef,
      to: move.to,
      ...(base === undefined ? {} : { base }),
    });
    setBusy(false);
    if (result.ok) onDone(result.value);
    else onFailed(result.errors);
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={move.to === "retired" ? "outline" : "default"} size="sm" disabled={busy}>
          {move.to === "retired" ? <Archive /> : <Check />} {move.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {move.label} {caseRef.split("/").at(-1)}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {title}. {move.says} The change is committed as you.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>{move.label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The case's run events (`runs`), newest first, each with why it ended as it
 * did; and "Record a result" (#93): what the QA saw executing the case by hand,
 * through one `run` call, after which the list is read again.
 */
function RunsCard({ caseRef, onRecorded }: { caseRef: string; onRecorded: () => void }) {
  const [result, setResult] = useState<Result<CaseRuns> | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  useEffect(() => {
    let current = true;
    setResult(null);
    setRecording(false);
    setRecorded(null);
    call<CaseRuns>("runs", { ref: caseRef }).then((r) => current && setResult(r));
    return () => {
      current = false;
    };
  }, [caseRef]);

  const done = async (value: Recorded) => {
    setRecording(false);
    setRecorded(value);
    setResult(await call<CaseRuns>("runs", { ref: caseRef }));
    onRecorded();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Runs</CardTitle>
        <CardDescription>Newest first, from the project&apos;s run files.</CardDescription>
        {recording ? null : (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRecorded(null);
                setRecording(true);
              }}
            >
              <ClipboardCheck /> Record a result
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {recording ? (
          <RunRecorder caseRef={caseRef} onRecorded={done} onCancel={() => setRecording(false)} />
        ) : null}
        {recorded === null ? null : (
          <p role="status" className="text-sm">
            {recorded.commit === undefined ? (
              <>
                Already recorded: {recorded.event.status} is still this case&apos;s last result in
                run <span className="font-mono text-xs">{recorded.run}</span>. Nothing was written.
              </>
            ) : (
              <>
                Recorded {recorded.event.status} in run{" "}
                <span className="font-mono text-xs">{recorded.run}</span>. Committed{" "}
                <span className="font-mono text-xs" title={recorded.commit.sha}>
                  {recorded.commit.sha.slice(0, 7)}
                </span>
                .
              </>
            )}
          </p>
        )}
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
                  // A long note scrolls: a labelled, focusable region, so the keyboard scrolls it too.
                  <section
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable
                    tabIndex={0}
                    aria-label={`Note of the ${run.status} run ${run.run_id}`}
                    className="max-h-64 overflow-auto rounded-md bg-muted p-3"
                  >
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                      {run.note}
                    </pre>
                  </section>
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
