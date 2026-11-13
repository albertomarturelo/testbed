import { ArrowLeft, Lock, Printer } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import {
  type CasefileError,
  call,
  type EvidenceDocument,
  type MilestoneClosed,
  type MilestoneReport,
  type Result,
} from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { RunBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatRoute } from "@/route";
import { FieldErrors } from "@/views/CaseFields";
import { Progress, utc } from "@/views/Milestones";
import { TicketField, ticketErrors, useTicket } from "@/views/TicketField";

/** A milestone's report, read again when `version` changes. */
function useReport(project: string, slug: string, version: number) {
  const [result, setResult] = useState<Result<MilestoneReport> | null>(null);
  const [own, setOwn] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the versions read the files again
  useEffect(() => {
    let current = true;
    setResult(null);
    call<MilestoneReport>("milestone-report", { project, slug }).then(
      (r) => current && setResult(r),
    );
    return () => {
      current = false;
    };
  }, [project, slug, version, own]);
  return { result, reload: () => setOwn((n) => n + 1) };
}

/**
 * One milestone (#166, ADR milestones-group-executions §7): its in-scope cases
 * with their latest result in it, the cases not executed, the gate verdicts,
 * and "Close". While open the page is generated from the files now; once
 * closed it is the frozen evidence file. A case opens over this page, where
 * "Record a result" names this milestone.
 */
export function MilestonePage({
  project,
  slug,
  version,
  onWritten,
}: {
  project: string;
  slug: string;
  /** Bumped by Refresh and by a write in a case over the page. */
  version: number;
  onWritten?: () => void;
}) {
  const { result, reload } = useReport(project, slug, version);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<MilestoneClosed | null>(null);

  if (result === null) return <Skeleton className="h-64 w-full" />;
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink project={project} />
        <ErrorList errors={result.errors} />
      </div>
    );
  }
  const report = result.value;
  const document = report.report;
  const red = report.red_gates ?? [];
  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <BackLink project={project} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={formatRoute({ view: "milestone", project, slug, evidence: true })}>
              <Printer /> Printable evidence
            </a>
          </Button>
          {report.state === "open" && !closing ? (
            <Button
              size="sm"
              onClick={() => {
                setClosed(null);
                setClosing(true);
              }}
            >
              <Lock /> Close milestone
            </Button>
          ) : null}
        </div>
      </div>

      {closing ? (
        <Card>
          <CardHeader>
            <CardTitle>Close {slug}</CardTitle>
          </CardHeader>
          <CardContent>
            <CloseMilestone
              project={project}
              slug={slug}
              red={red}
              onClosed={(value) => {
                setClosing(false);
                setClosed(value);
                reload();
                onWritten?.();
              }}
              onCancel={() => setClosing(false)}
            />
          </CardContent>
        </Card>
      ) : null}
      {closed === null ? null : (
        <p role="status" className="text-sm">
          Closed {closed.slug}: its evidence is frozen in{" "}
          <span className="font-mono text-xs">{closed.evidence}</span>. Committed{" "}
          <span className="font-mono text-xs" title={closed.commit.sha}>
            {closed.commit.sha.slice(0, 7)}
          </span>
          : {closed.commit.message.split("\n", 1)[0]}
        </p>
      )}

      <p className="text-muted-foreground text-sm">
        {report.state === "open"
          ? "Open: generated from the run files now. Closing freezes it."
          : `Closed: the frozen evidence in ${report.path}.`}
      </p>
      {document === undefined ? (
        <FrozenText report={report} />
      ) : (
        <EvidenceSections document={document} links />
      )}
    </article>
  );
}

function BackLink({ project }: { project: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <a href={formatRoute({ view: "milestones", project })}>
        <ArrowLeft /> Milestones
      </a>
    </Button>
  );
}

/** A frozen file no longer in the shape core writes: shown as it is, never re-generated. */
function FrozenText({ report }: { report: MilestoneReport }) {
  return (
    <div className="flex flex-col gap-2">
      <ErrorList
        errors={[
          {
            code: "ui.evidence_unreadable",
            severity: "warning",
            path: report.path,
            message:
              "This evidence file no longer has the shape casefile writes (edited by hand?): it is shown as it is.",
          },
        ]}
      />
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border p-4 text-xs">
        {report.evidence}
      </pre>
    </div>
  );
}

/**
 * The printable evidence (#166, ADR milestones-group-executions §6): the same
 * document as the milestone page, laid out for paper. "Print" opens the
 * browser's dialog, where "Save as PDF" makes the PDF; no dependency does.
 */
export function EvidencePrint({
  project,
  slug,
  version,
}: {
  project: string;
  slug: string;
  version: number;
}) {
  const { result } = useReport(project, slug, version);
  const document_ = result?.ok ? result.value.report : undefined;
  // The title is the PDF's default file name.
  useEffect(() => {
    if (document_ === undefined) return;
    const before = document.title;
    document.title = `Milestone evidence ${document_.project} ${document_.slug}`;
    return () => {
      document.title = before;
    };
  }, [document_]);

  if (result === null) return <Skeleton className="h-64 w-full" />;
  return (
    <article className="evidence-print mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <a href={formatRoute({ view: "milestone", project, slug })}>
            <ArrowLeft /> Back to the milestone
          </a>
        </Button>
        {result.ok && document_ !== undefined ? (
          <Button size="sm" className="ml-auto" onClick={() => window.print()}>
            <Printer /> Print or save as PDF
          </Button>
        ) : null}
      </div>
      {!result.ok ? (
        <ErrorList errors={result.errors} />
      ) : document_ === undefined ? (
        <FrozenText report={result.value} />
      ) : (
        <EvidenceSections document={document_} />
      )}
    </article>
  );
}

/**
 * The evidence, in the order of its file: the milestone, totals, gates, cases,
 * the cases not executed and the close note. On paper, the cases and what was
 * not executed each start a page; rows never split.
 */
export function EvidenceSections({
  document,
  links = false,
}: {
  document: EvidenceDocument;
  /** Case ids link to the case (on screen); on paper they are plain text. */
  links?: boolean;
}) {
  const d = document;
  const missing = d.cases.filter((c) => c.result === null);
  const stamp = (s: { at: string; by: string } | null, none: string) =>
    s === null ? none : `${utc(s.at)} by ${s.by}`;
  const fields: [string, string][] = [
    ["Milestone", `${d.slug} (project ${d.project})`],
    ["Release", d.release ?? "—"],
    ["Due", d.due ?? "—"],
    ["Scope", d.scope],
    ["Build", d.build ?? "—"],
    ["Opened", stamp(d.opened, "—")],
    ["Closed", stamp(d.closed, "not closed: a report, not frozen evidence")],
  ];
  return (
    <div className="flex flex-col gap-8 print:gap-6">
      <header className="flex flex-col gap-4 break-inside-avoid">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-2xl tracking-tight">{d.title}</h1>
          <Badge variant={d.closed === null ? "outline" : "secondary"}>
            {d.closed === null ? "open" : "closed"}
          </Badge>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={cn("break-words", label === "Scope" && "font-mono text-xs")}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <EvidenceSection title="Totals">
        <div className="flex flex-col gap-3">
          <Progress totals={d.totals} />
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(
              [
                ["In scope", d.totals.in_scope],
                ["Executed", d.totals.executed],
                ["Passed", d.totals.passed],
                ["Failed", d.totals.failed],
                ["Blocked", d.totals.blocked],
                ["Not run", d.totals.not_run],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="font-semibold text-lg tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </EvidenceSection>

      {d.gates === null ? null : (
        <EvidenceSection title="Gates">
          {d.gates.length === 0 ? (
            <p className="text-muted-foreground text-sm">The release policy declares no gates.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gate</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead className="text-right">Cases</TableHead>
                  <TableHead>Reasons</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.gates.map((gate) => (
                  <TableRow key={gate.name} className="break-inside-avoid">
                    <TableCell className="font-medium">{gate.name}</TableCell>
                    <TableCell>
                      <Badge variant={gate.verdict === "red" ? "destructive" : "secondary"}>
                        {gate.verdict}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{gate.cases}</TableCell>
                    <TableCell className="whitespace-normal break-words text-sm">
                      {gate.reasons ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </EvidenceSection>
      )}

      <EvidenceSection title="Cases" newPage>
        {d.cases.length === 0 ? (
          <p className="text-muted-foreground text-sm">The scope selects no cases.</p>
        ) : (
          <div className="@container">
            {/* On paper every column shows, so the six fit an A4 or Letter width. */}
            <Table className="print:**:text-[10px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden @3xl:table-cell print:table-cell">
                    Executed
                  </TableHead>
                  <TableHead className="hidden @3xl:table-cell print:table-cell">
                    Note and evidence
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.cases.map((c) => (
                  <TableRow key={c.id} className="break-inside-avoid align-top">
                    <TableCell className="font-mono text-xs">
                      {links ? (
                        <a
                          className="hover:underline"
                          href={formatRoute({ view: "case", ref: `${d.project}/${c.id}` })}
                        >
                          {c.id}
                        </a>
                      ) : (
                        c.id
                      )}
                    </TableCell>
                    <TableCell className="min-w-32 whitespace-normal break-words">
                      {c.title}
                    </TableCell>
                    <TableCell>{c.priority}</TableCell>
                    <TableCell>
                      {c.result === null ? (
                        <span className="text-muted-foreground text-xs">not run</span>
                      ) : (
                        <RunBadge status={c.result} />
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal text-xs @3xl:table-cell print:table-cell">
                      {c.executor === null && c.at === null ? (
                        "—"
                      ) : (
                        <div className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                          <span>{c.executor ?? "—"}</span>
                          <span className="text-muted-foreground">
                            {c.at === null ? "—" : utc(c.at)}
                          </span>
                          {c.build === null ? null : (
                            <span className="font-mono text-muted-foreground">{c.build}</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden min-w-40 whitespace-normal text-xs @3xl:table-cell print:table-cell">
                      {c.note === null && c.evidence.length === 0 ? (
                        "—"
                      ) : (
                        <div className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                          {c.note === null ? null : <span>{c.note}</span>}
                          {c.evidence.map((ref) => (
                            <span key={ref} className="font-mono text-muted-foreground">
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </EvidenceSection>

      <EvidenceSection title="Not executed" newPage={missing.length > 0}>
        {missing.length === 0 ? (
          <p className="text-sm">Every case in scope was executed.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {missing.map((c) => (
              <li key={c.id} className="break-inside-avoid">
                <span className="font-mono text-xs">
                  {links ? (
                    <a
                      className="hover:underline"
                      href={formatRoute({ view: "case", ref: `${d.project}/${c.id}` })}
                    >
                      {c.id}
                    </a>
                  ) : (
                    c.id
                  )}
                </span>{" "}
                {c.title}
              </li>
            ))}
          </ul>
        )}
      </EvidenceSection>

      {d.note === null ? null : (
        <EvidenceSection title="Close note">
          <p className="whitespace-pre-wrap text-sm">{d.note}</p>
        </EvidenceSection>
      )}
    </div>
  );
}

function EvidenceSection({
  title,
  newPage = false,
  children,
}: {
  title: string;
  /** On paper, start this section on a new page. */
  newPage?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-3", newPage && "print:break-before-page")}
    >
      <h2 id={id} className="break-after-avoid font-semibold text-lg">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * One `milestone-close` call (ADR milestones-group-executions §2, §4): red
 * gates do not block, but the note saying why they are accepted is required
 * then; core refuses without it (`milestone.red_gates`).
 */
function CloseMilestone({
  project,
  slug,
  red,
  onClosed,
  onCancel,
}: {
  project: string;
  slug: string;
  /** The gates red now, from the report. */
  red: readonly string[];
  onClosed: (closed: MilestoneClosed) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<CasefileError[]>([]);
  const [saving, setSaving] = useState(false);
  const ticket = useTicket();
  const needsNote = red.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = note.trim();
    if (needsNote && text === "") {
      setErrors([
        {
          code: "ui.required",
          field: "note",
          message: "Gates are red: say why they are accepted.",
        },
      ]);
      return;
    }
    setSaving(true);
    const result = await call<MilestoneClosed>("milestone-close", {
      project,
      slug,
      ...(text === "" ? {} : { note: text }),
      ...ticket.input(),
    });
    setSaving(false);
    if (result.ok) onClosed(result.value);
    else setErrors(result.errors);
  };

  const placed = ticketErrors(errors);
  const noteErrors = placed.rest.filter((e) => e.field === "note");
  const rest = placed.rest.filter((e) => e.field !== "note");
  const invalid = noteErrors.length > 0 || undefined;
  return (
    <form onSubmit={submit} aria-label="Close the milestone" className="flex flex-col gap-4">
      {rest.length === 0 ? null : <ErrorList errors={rest} />}
      <p className="text-sm">
        Closing writes the evidence of what was executed in {slug} and commits it as you. It cannot
        be reopened: results can no longer be recorded in it, and a correction is a new milestone.
      </p>
      <FieldGroup>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${id}-note`}>
            {needsNote ? "Why are the red gates accepted?" : "Note"}
          </FieldLabel>
          <Textarea
            id={`${id}-note`}
            rows={3}
            value={note}
            aria-invalid={invalid}
            onChange={(e) => {
              setNote(e.target.value);
              setErrors((all) => all.filter((error) => error.field !== "note"));
            }}
          />
          <FieldDescription>
            {needsNote
              ? `Red now: ${red.join(", ")}. The note goes into the evidence.`
              : "Optional. Goes into the evidence."}
          </FieldDescription>
          <FieldErrors errors={noteErrors} />
        </Field>
        <TicketField ticket={ticket} errors={placed.ticket} />
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Closing…" : "Close and freeze the evidence"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
