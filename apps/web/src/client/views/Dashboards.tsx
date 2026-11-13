import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  call,
  type DashboardList,
  type DashboardRow,
  type DashboardShown,
  type Result,
  SERIES_STATUSES,
  type SeriesStatus,
  type WidgetData,
  type WidgetView,
} from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
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

// The viewer draws what `dashboard show` computed (ADR dashboards-as-files §5–6):
// it never counts. A dashboard is read-only here; the agent writes it (#188).

/** What the QA asks the agent for when a project has no dashboard yet. */
export const ASK_THE_AGENT = "/qa-dashboard";

/** `#/dashboards`: every dashboard of the selected project (or all). */
export function Dashboards({
  project,
  projects,
  version,
}: {
  project?: string;
  projects: readonly string[];
  /** Bumped by Refresh: read the files again. */
  version: number;
}) {
  const [result, setResult] = useState<Result<DashboardList> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` reads the files again
  useEffect(() => {
    let current = true;
    setResult(null);
    call<DashboardList>("dashboard-list", project === undefined ? {} : { project }).then(
      (r) => current && setResult(r),
    );
    return () => {
      current = false;
    };
  }, [project, version]);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="dashboards-title">
      <h1 id="dashboards-title" className="font-semibold text-xl tracking-tight">
        Dashboards
      </h1>
      <p className="max-w-prose text-muted-foreground text-sm">
        A dashboard counts the cases and executions its widgets select, computed from the files each
        time it opens. Ask your agent to build or change one.
      </p>
      {result === null ? (
        <Skeleton className="h-40 w-full" />
      ) : !result.ok ? (
        <ErrorList errors={result.errors} />
      ) : (
        <DashboardTable
          rows={result.value.dashboards}
          showProject={project === undefined && projects.length > 1}
        />
      )}
    </section>
  );
}

function DashboardTable({
  rows,
  showProject,
}: {
  rows: readonly DashboardRow[];
  showProject: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground text-sm">
        <LayoutDashboard aria-hidden className="size-6" />
        <p>No dashboards yet.</p>
        <p className="max-w-prose">
          Ask your agent for one, for example{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs">
            {ASK_THE_AGENT} a dashboard for release 2.0
          </code>
          . It saves it under <span className="font-mono text-xs">context/dashboards/</span> and it
          shows up here.
        </p>
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Dashboard</TableHead>
          {showProject ? <TableHead>Project</TableHead> : null}
          <TableHead className="text-right">Widgets</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={`${d.project}/${d.slug}`}>
            <TableCell className="w-full max-w-0 whitespace-normal">
              <a
                className="flex flex-col hover:underline"
                href={formatRoute({ view: "dashboard", project: d.project, slug: d.slug })}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <LayoutDashboard
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="line-clamp-2 break-words">{d.title}</span>
                </span>
                {d.description === null ? null : (
                  <span className="line-clamp-2 text-muted-foreground text-xs">
                    {d.description}
                  </span>
                )}
              </a>
            </TableCell>
            {showProject ? <TableCell>{d.project}</TableCell> : null}
            <TableCell className="text-right tabular-nums">{d.widgets}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** `#/dashboard/<project>/<slug>`: its widgets on a 12-column grid, in file order. */
export function DashboardPage({
  project,
  slug,
  version,
}: {
  project: string;
  slug: string;
  /** Bumped by Refresh: compute it again. */
  version: number;
}) {
  const [result, setResult] = useState<Result<DashboardShown> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` computes it again
  useEffect(() => {
    let current = true;
    setResult(null);
    call<DashboardShown>("dashboard-show", { project, slug }).then((r) => current && setResult(r));
    return () => {
      current = false;
    };
  }, [project, slug, version]);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="dashboard-title">
      <a
        href={formatRoute({ view: "dashboards", project })}
        className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:underline"
      >
        <ArrowLeft aria-hidden className="size-3.5" /> Dashboards
      </a>
      {result === null ? (
        <Skeleton className="h-64 w-full" />
      ) : !result.ok ? (
        <ErrorList errors={result.errors} />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 id="dashboard-title" className="font-semibold text-xl tracking-tight">
              {result.value.title}
            </h1>
            {result.value.description === null ? null : (
              <p className="max-w-prose text-sm">{result.value.description}</p>
            )}
            <p className="text-muted-foreground text-xs">
              Computed from the files on {result.value.date} (UTC) ·{" "}
              <span className="font-mono">{result.value.path}</span>
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {result.value.widgets.map((w) => (
              <WidgetCard key={w.id} widget={w} project={project} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Literal classes, so Tailwind sees each one: `lg:col-span-<width>`. */
const SPAN: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  10: "lg:col-span-10",
  11: "lg:col-span-11",
  12: "lg:col-span-12",
};

function WidgetCard({ widget, project }: { widget: WidgetView; project: string }) {
  const titleId = `widget-${widget.id}`;
  return (
    <Card
      className={cn("min-w-0 gap-3 py-4", SPAN[widget.width] ?? SPAN[12])}
      aria-labelledby={titleId}
      role="region"
      data-widget={widget.id}
    >
      <CardHeader className="px-4">
        <CardTitle id={titleId} className="text-sm">
          {widget.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {widget.error !== undefined ? (
          <Alert variant="destructive">
            <AlertTitle>This widget cannot be computed</AlertTitle>
            <AlertDescription>
              <span>
                <span className="font-mono text-xs">{widget.error.code}</span>:{" "}
                {widget.error.message}
              </span>
            </AlertDescription>
          </Alert>
        ) : widget.data === undefined ? null : (
          <WidgetBody data={widget.data} title={widget.title} project={project} />
        )}
      </CardContent>
    </Card>
  );
}

function WidgetBody({
  data,
  title,
  project,
}: {
  data: WidgetData;
  title: string;
  project: string;
}) {
  switch (data.type) {
    case "stat":
      return (
        <p className="font-semibold text-4xl tabular-nums tracking-tight">
          {data.value}
          <span className="sr-only"> cases</span>
        </p>
      );
    case "bar":
      return <GroupBars groups={data.groups} total={data.total} title={title} />;
    case "donut":
      return <GroupDonut groups={data.groups} total={data.total} title={title} />;
    case "table":
      return <CaseTable data={data} project={project} />;
    case "timeseries":
      return <Series days={data.days} total={data.total} title={title} />;
  }
}

const NO_VALUE = "(none)";
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const STATUS_COLOR: Record<SeriesStatus, string> = {
  passed: "var(--status-passed)",
  failed: "var(--status-failed)",
  blocked: "var(--status-blocked)",
  skipped: "var(--status-skipped)",
  not_run: "var(--status-not-run)",
};

const isStatus = (value: string): value is SeriesStatus =>
  (SERIES_STATUSES as readonly string[]).includes(value);

/** How a value reads: `not_run` is "not run". */
const label = (value: string) => (isStatus(value) ? value.replace("_", " ") : value);

/**
 * A group's colour. A run status (what `last_result` groups by) keeps its
 * meaning in every widget; `(none)` is muted; other values cycle the palette.
 */
function groupColor(value: string, index: number): string {
  if (isStatus(value)) return STATUS_COLOR[value];
  if (value === NO_VALUE) return "var(--muted-foreground)";
  return PALETTE[index % PALETTE.length] as string;
}

type Group = { value: string; count: number };

/**
 * Chart series keyed `g0`, `g1`…: the key becomes a CSS variable name in the
 * chart's `<style>`, so a value from a file (a feature, a label) is never one.
 */
function groupSeries(groups: readonly Group[]) {
  const rows = groups.map((g, i) => ({
    key: `g${i}`,
    label: label(g.value),
    count: g.count,
    fill: groupColor(g.value, i),
  }));
  const config: ChartConfig = Object.fromEntries(
    rows.map((r) => [r.key, { label: r.label, color: r.fill }]),
  );
  return { rows, config };
}

/** What a screen reader hears for a chart: its title, then every value. */
const summary = (title: string, parts: readonly string[]) =>
  `${title}: ${parts.length === 0 ? "no cases" : parts.join(", ")}`;

function NoCases() {
  return <p className="py-6 text-center text-muted-foreground text-sm">No matching cases.</p>;
}

/** Horizontal bars, largest first, each with its count written at its end. */
function GroupBars({
  groups,
  total,
  title,
}: {
  groups: readonly Group[];
  total: number;
  title: string;
}) {
  if (groups.length === 0) return <NoCases />;
  const { rows, config } = groupSeries(groups);
  const longest = Math.max(...rows.map((r) => r.label.length));
  return (
    <div className="flex flex-col gap-2">
      <ChartContainer
        config={config}
        role="img"
        aria-label={summary(
          title,
          rows.map((r) => `${r.label} ${r.count}`),
        )}
        className="aspect-auto w-full"
        style={{ height: rows.length * 32 + 16 }}
      >
        <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 32, top: 4, bottom: 4 }}>
          <XAxis type="number" dataKey="count" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={Math.min(200, Math.max(48, longest * 7 + 8))}
          />
          <Bar dataKey="count" radius={4} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={r.fill} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              className="fill-foreground tabular-nums"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <Total total={total} />
    </div>
  );
}

/** A donut with a legend that names every slice and its count. */
function GroupDonut({
  groups,
  total,
  title,
}: {
  groups: readonly Group[];
  total: number;
  title: string;
}) {
  if (groups.length === 0) return <NoCases />;
  const { rows, config } = groupSeries(groups);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ChartContainer
        config={config}
        role="img"
        aria-label={summary(
          title,
          rows.map((r) => `${r.label} ${r.count}`),
        )}
        className="aspect-square h-40 shrink-0"
      >
        <PieChart>
          <Pie
            data={rows}
            dataKey="count"
            nameKey="label"
            innerRadius="55%"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={r.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex min-w-32 flex-1 flex-col gap-2">
        <Legend
          items={rows.map((r) => ({ key: r.key, label: r.label, count: r.count, color: r.fill }))}
        />
        <Total total={total} />
      </div>
    </div>
  );
}

/** The values of a chart as text: readable without hovering it. */
function Legend({
  items,
}: {
  items: readonly { key: string; label: string; count: number; color: string }[];
}) {
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-hidden>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: item.color }} />
          <span className="min-w-0 flex-1 truncate" title={item.label}>
            {item.label}
          </span>
          <span className="tabular-nums">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Total({ total }: { total: number }) {
  return (
    <p className="text-muted-foreground text-xs tabular-nums">
      {total} matching {total === 1 ? "case" : "cases"}
    </p>
  );
}

/** The matching cases, `id` first; an id opens the case over the dashboard. */
function CaseTable({
  data,
  project,
}: {
  data: Extract<WidgetData, { type: "table" }>;
  project: string;
}) {
  if (data.rows.length === 0) return <NoCases />;
  const [, ...columns] = data.columns;
  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>id</TableHead>
            {columns.map((c) => (
              <TableHead key={c} className="font-mono text-xs">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono text-xs">
                <a
                  className="underline"
                  href={formatRoute({ view: "case", ref: `${project}/${row.id}` })}
                >
                  {row.id}
                </a>
              </TableCell>
              {row.cells.map((cell, i) => (
                <TableCell
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional, one per column
                  key={i}
                  className="max-w-80 whitespace-normal break-words"
                >
                  {isStatus(cell) ? label(cell) : cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-muted-foreground text-xs tabular-nums">
        {data.rows.length < data.total
          ? `The first ${data.rows.length} of ${data.total} matching cases`
          : `${data.total} matching ${data.total === 1 ? "case" : "cases"}`}
      </p>
    </div>
  );
}

const SERIES_CONFIG: ChartConfig = Object.fromEntries(
  SERIES_STATUSES.map((s) => [s, { label: label(s), color: STATUS_COLOR[s] }]),
);

type Day = Extract<WidgetData, { type: "timeseries" }>["days"][number];

/** Executions per day, stacked by status; totals and a per-day table as text. */
function Series({ days, total, title }: { days: readonly Day[]; total: number; title: string }) {
  if (days.length === 0 || total === 0) {
    return (
      <p className="py-6 text-center text-muted-foreground text-sm">
        {days.length === 0
          ? "No executions in the milestone yet."
          : `No executions in these ${days.length} days.`}
      </p>
    );
  }
  const totals = SERIES_STATUSES.map((s) => ({
    key: s,
    label: label(s),
    count: days.reduce((sum, d) => sum + d[s], 0),
    color: STATUS_COLOR[s],
  })).filter((t) => t.count > 0);
  const shown = new Set(totals.map((t) => t.key));
  const active = days.filter((d) => SERIES_STATUSES.some((s) => d[s] > 0));
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  return (
    <div className="flex flex-col gap-3">
      <ChartContainer
        config={SERIES_CONFIG}
        role="img"
        aria-label={summary(
          `${title}, ${first} to ${last}`,
          active.map(
            (d) =>
              `${d.date}: ${SERIES_STATUSES.filter((s) => d[s] > 0)
                .map((s) => `${d[s]} ${label(s)}`)
                .join(", ")}`,
          ),
        )}
        className="aspect-auto h-56 w-full"
      >
        <BarChart data={days as Day[]} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickFormatter={(date: string) => date.slice(5)}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {SERIES_STATUSES.filter((s) => shown.has(s)).map((s) => (
            <Bar
              key={s}
              dataKey={s}
              stackId="runs"
              maxBarSize={48}
              fill={`var(--color-${s})`}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="min-w-40">
          <Legend items={totals} />
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          {total} {total === 1 ? "execution" : "executions"} from {first} to {last}
        </p>
      </div>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-muted-foreground text-xs hover:underline">
          Executions per day ({active.length} {active.length === 1 ? "day" : "days"} with any)
        </summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              {SERIES_STATUSES.map((s) => (
                <TableHead key={s} className="text-right">
                  {label(s)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((d) => (
              <TableRow key={d.date}>
                <TableCell className="font-mono text-xs">{d.date}</TableCell>
                {SERIES_STATUSES.map((s) => (
                  <TableCell key={s} className="text-right tabular-nums">
                    {d[s]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  );
}
