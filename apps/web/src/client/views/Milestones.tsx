import { Flag, Plus } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import {
  type CasefileError,
  call,
  type EvidenceTotals,
  type MilestoneList,
  type MilestoneOpened,
  type MilestoneRow,
  type Result,
} from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { FieldErrors } from "@/views/CaseFields";
import { TicketField, ticketErrors, useTicket } from "@/views/TicketField";

/**
 * The Milestones view (#166, ADR milestones-group-executions §7): every
 * milestone of the selected project (or all), open ones first, with its
 * progress, and "Open milestone". A milestone's page has its cases and gates.
 */
export function Milestones({
  project,
  projects,
}: {
  project?: string;
  /** Every project of the workspace: the form asks which one when none is selected. */
  projects: readonly string[];
}) {
  const [result, setResult] = useState<Result<MilestoneList> | null>(null);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState<MilestoneOpened | null>(null);
  const [version, setVersion] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` reads the files again
  useEffect(() => {
    let current = true;
    setResult(null);
    call<MilestoneList>("milestone-list", project === undefined ? {} : { project }).then(
      (r) => current && setResult(r),
    );
    return () => {
      current = false;
    };
  }, [project, version]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="milestones-title">
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="milestones-title" className="mr-auto font-semibold text-xl tracking-tight">
          Milestones
        </h1>
        {opening ? null : (
          <Button
            size="sm"
            onClick={() => {
              setOpened(null);
              setOpening(true);
            }}
          >
            <Plus /> Open milestone
          </Button>
        )}
      </div>
      <p className="max-w-prose text-muted-foreground text-sm">
        A milestone groups the executions of a release, a sprint regression or a UAT round. Record
        results into an open one; closing it freezes its evidence.
      </p>
      {opening ? (
        <Card>
          <CardHeader>
            <CardTitle>Open a milestone</CardTitle>
          </CardHeader>
          <CardContent>
            <OpenMilestone
              project={project}
              projects={projects}
              onOpened={(value) => {
                setOpening(false);
                setOpened(value);
                setVersion((n) => n + 1);
              }}
              onCancel={() => setOpening(false)}
            />
          </CardContent>
        </Card>
      ) : null}
      {opened === null ? null : (
        <p role="status" className="text-sm">
          Opened{" "}
          <a
            className="font-mono text-xs underline"
            href={formatRoute({ view: "milestone", project: opened.project, slug: opened.slug })}
          >
            {opened.slug}
          </a>
          . Committed{" "}
          <span className="font-mono text-xs" title={opened.commit.sha}>
            {opened.commit.sha.slice(0, 7)}
          </span>
          : {opened.commit.message.split("\n", 1)[0]}
        </p>
      )}
      {result === null ? (
        <Skeleton className="h-40 w-full" />
      ) : !result.ok ? (
        <ErrorList errors={result.errors} />
      ) : (
        <MilestoneTable
          rows={result.value.milestones}
          showProject={project === undefined && projects.length > 1}
        />
      )}
    </section>
  );
}

function MilestoneTable({
  rows,
  showProject,
}: {
  rows: readonly MilestoneRow[];
  showProject: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground text-sm">
        No milestones yet. Open one to record executions in it.
      </p>
    );
  }
  const groups = [
    ["Open", rows.filter((m) => m.state === "open")],
    ["Closed", rows.filter((m) => m.state === "closed")],
  ] as const;
  const columns = 4 + Number(showProject);
  return (
    <div className="@container">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Milestone</TableHead>
            {showProject ? <TableHead>Project</TableHead> : null}
            <TableHead>Progress</TableHead>
            <TableHead className="hidden @3xl:table-cell">Gates</TableHead>
            <TableHead>Due</TableHead>
          </TableRow>
        </TableHeader>
        {groups.map(([label, group]) =>
          group.length === 0 ? null : (
            <TableBody key={label}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <th
                  scope="rowgroup"
                  colSpan={columns}
                  className="px-2 py-1.5 text-left font-medium"
                >
                  {label}{" "}
                  <span className="font-normal text-muted-foreground">· {group.length}</span>
                </th>
              </TableRow>
              {group.map((m) => (
                <TableRow key={`${m.project}/${m.slug}`}>
                  <TableCell className="w-full max-w-0 whitespace-normal">
                    <a
                      className="flex flex-col hover:underline"
                      href={formatRoute({ view: "milestone", project: m.project, slug: m.slug })}
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        <Flag aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="line-clamp-2 break-words">{m.title}</span>
                      </span>
                      <span className="font-mono text-muted-foreground text-xs">
                        {m.slug}
                        {m.release !== null && m.release !== m.slug ? ` · ${m.release}` : ""}
                      </span>
                    </a>
                  </TableCell>
                  {showProject ? <TableCell>{m.project}</TableCell> : null}
                  <TableCell>
                    {m.totals === null ? (
                      <span className="text-muted-foreground text-xs">
                        cannot be read: open it to see why
                      </span>
                    ) : (
                      <Progress totals={m.totals} />
                    )}
                  </TableCell>
                  <TableCell className="hidden @3xl:table-cell">
                    <RedGates names={m.red_gates} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {m.state === "closed" && m.closed !== null ? (
                      <span className="text-muted-foreground text-xs">
                        closed {utc(m.closed.at)}
                      </span>
                    ) : (
                      (m.due ?? <span className="text-muted-foreground text-xs">no date</span>)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ),
        )}
      </Table>
    </div>
  );
}

/** "N of M executed, X passed", with a bar: passed, then failed or blocked, then not run. */
export function Progress({ totals }: { totals: EvidenceTotals }) {
  const { in_scope, executed, passed } = totals;
  const share = (n: number) => (in_scope === 0 ? 0 : (n / in_scope) * 100);
  return (
    <div className="flex min-w-36 flex-col gap-1">
      <span className="text-sm tabular-nums">
        {executed} of {in_scope} executed, {passed} passed
      </span>
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        aria-hidden
        title={`${passed} passed · ${totals.failed} failed · ${totals.blocked} blocked · ${totals.not_run} not run`}
      >
        <div className="bg-primary" style={{ width: `${share(passed)}%` }} />
        <div className="bg-destructive" style={{ width: `${share(executed - passed)}%` }} />
      </div>
    </div>
  );
}

/** Gates that are red; nothing when none is (or the project has no policy). */
export function RedGates({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((name) => (
        <Badge key={name} variant="destructive" title={`Gate ${name} is red`}>
          {name}
        </Badge>
      ))}
    </div>
  );
}

/** The inputs of `milestone-open` the form has; an error naming one shows under it. */
const INPUTS = ["project", "slug", "title", "due", "release", "scope"] as const;
type InputName = (typeof INPUTS)[number];

/**
 * One `milestone-open` call with what the QA filled (ADR
 * human-writes-through-operations): the viewer commits it as them.
 */
function OpenMilestone({
  project,
  projects,
  onOpened,
  onCancel,
}: {
  project?: string;
  projects: readonly string[];
  onOpened: (opened: MilestoneOpened) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState<Record<InputName, string>>({
    project: project ?? (projects.length === 1 ? (projects[0] ?? "") : ""),
    slug: "",
    title: "",
    due: "",
    release: "",
    scope: "",
  });
  const [errors, setErrors] = useState<CasefileError[]>([]);
  const [saving, setSaving] = useState(false);
  const ticket = useTicket();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const filled = Object.fromEntries(
      Object.entries(text)
        .map(([name, value]) => [name, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    setSaving(true);
    const result = await call<MilestoneOpened>("milestone-open", { ...filled, ...ticket.input() });
    setSaving(false);
    if (result.ok) onOpened(result.value);
    else setErrors(result.errors);
  };

  const at = (name: InputName) => errors.filter((e) => e.field === name);
  const placed = ticketErrors(errors);
  const rest = placed.rest.filter((e) => !INPUTS.includes(e.field as InputName));
  const invalid = (name: InputName) => at(name).length > 0 || undefined;
  const line = (
    name: Exclude<InputName, "project">,
    label: string,
    options: { hint?: string; description?: string; type?: string; required?: boolean },
  ) => (
    <Field data-invalid={invalid(name)}>
      <FieldLabel htmlFor={`${id}-${name}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${name}`}
        type={options.type ?? "text"}
        value={text[name]}
        placeholder={options.hint}
        required={options.required}
        aria-invalid={invalid(name)}
        onChange={(e) => setText((t) => ({ ...t, [name]: e.target.value }))}
      />
      {options.description === undefined ? null : (
        <FieldDescription>{options.description}</FieldDescription>
      )}
      <FieldErrors errors={at(name)} />
    </Field>
  );

  return (
    <form onSubmit={submit} aria-label="Open a milestone" className="flex flex-col gap-4">
      {rest.length === 0 ? null : <ErrorList errors={rest} />}
      <FieldGroup>
        {projects.length > 1 && project === undefined ? (
          <Field data-invalid={invalid("project")}>
            <FieldLabel htmlFor={`${id}-project`}>Project</FieldLabel>
            <NativeSelect
              id={`${id}-project`}
              value={text.project}
              required
              aria-invalid={invalid("project")}
              onChange={(e) => setText((t) => ({ ...t, project: e.target.value }))}
            >
              <NativeSelectOption value="">Choose…</NativeSelectOption>
              {projects.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {p}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldErrors errors={at("project")} />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {line("title", "Title", { hint: "Web 2.1.0", required: true })}
          {line("slug", "Slug", {
            hint: "web-2.1.0",
            required: true,
            description: "The file name, and what results name: letters, digits, . _ -",
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {line("due", "Due", { type: "date", description: "Optional." })}
          {line("release", "Release", {
            hint: "v2.1.0",
            description: "Optional: the version or Git tag it certifies.",
          })}
        </div>
        {line("scope", "Scope", {
          hint: "state = active",
          description:
            "Optional: a query of the cases it covers, as in Query. Empty: every active case.",
        })}
        <TicketField ticket={ticket} errors={placed.ticket} />
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Opening…" : "Open"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * A timestamp of the evidence as its file has it, in UTC (`2026-10-14 07:00 UTC`):
 * evidence read in another time zone, or printed, says the same time.
 */
export function utc(iso: string): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/);
  return match === null ? iso : `${match[1]} ${match[2]} UTC`;
}
