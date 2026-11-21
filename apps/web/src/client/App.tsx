import {
  Check,
  ChevronsUpDown,
  Eye,
  EyeOff,
  FileCheck2,
  FilePen,
  Flag,
  FolderGit2,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { type Covered, call, type Overview, type Result, type Session, session } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { compareFeatures, FeatureTree, inFeature } from "@/components/FeatureTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoredFlag } from "@/lib/stored";
import { cn } from "@/lib/utils";
import { DRAFT, formatRoute, parseRoute, type Route, type StateFilter } from "@/route";
import { CaseList } from "@/views/CaseList";
import { CaseSheet } from "@/views/CaseSheet";
import type * as DashboardViews from "@/views/Dashboards";
import { EvidencePrint, MilestonePage } from "@/views/MilestonePage";
import { Milestones } from "@/views/Milestones";
import { NewCase } from "@/views/NewCase";
import { QueryView } from "@/views/QueryView";
import { ValidateView } from "@/views/ValidateView";

// Dashboards bring Recharts (#187): a chunk of its own, loaded when one is opened.
// A chunk that does not load (a tab left open across an upgrade) says so in place
// instead of unmounting the whole viewer.
const dashboardsChunk = (): Promise<Pick<typeof DashboardViews, "Dashboards" | "DashboardPage">> =>
  import("@/views/Dashboards").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const NotLoaded = () => (
      <ErrorList
        errors={[
          {
            code: "ui.unreachable",
            message: `the dashboards view did not load (${message}): reload the page`,
          },
        ]}
      />
    );
    return { Dashboards: NotLoaded, DashboardPage: NotLoaded };
  });
const Dashboards = lazy(() => dashboardsChunk().then((m) => ({ default: m.Dashboards })));
const DashboardPage = lazy(() => dashboardsChunk().then((m) => ({ default: m.DashboardPage })));

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Where the server's identity came from, as the QA would set it. */
const SOURCES: Record<NonNullable<Session["identity"]>["source"], string> = {
  explicit: "given explicitly",
  env: "from CASEFILE_USER_EMAIL",
  git: "from git config user.email",
};

/** Who what the QA writes here is committed as (ADR identity-override §4–5). */
function ActingAs() {
  const [current, setCurrent] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    session().then(setCurrent);
  }, []);
  if (current === undefined) return null;
  const identity = current?.identity ?? null;
  // Collapsed to icons, the icon stays: red while nobody is configured (#222).
  const text =
    identity === null
      ? "No identity: set CASEFILE_USER_EMAIL or git config user.email to write"
      : `Acting as ${identity.name ? `${identity.name} <${identity.email}>` : identity.email}`;
  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 text-xs break-words",
        identity === null ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {/* Collapsed, the text is hidden: the icon's title still says it. */}
      <span title={text} className="shrink-0">
        {identity === null ? (
          <TriangleAlert className="size-4" aria-hidden />
        ) : (
          <UserRound className="size-4" aria-hidden />
        )}
      </span>
      <span
        className="min-w-0 group-data-[collapsible=icon]:sr-only"
        title={identity === null ? undefined : SOURCES[identity.source]}
      >
        {text}
      </span>
    </div>
  );
}

/** The views the sidebar lists, in its order (#222). */
const VIEWS = [
  { view: "dashboards", label: "Dashboards", icon: LayoutDashboard },
  { view: "cases", label: "Cases", icon: ListChecks },
  { view: "milestones", label: "Milestones", icon: Flag },
  { view: "query", label: "Query", icon: Search },
  { view: "validate", label: "Validate", icon: ShieldCheck },
] as const satisfies readonly { view: Route["view"]; label: string; icon: LucideIcon }[];
type ListView = (typeof VIEWS)[number]["view"];

/** Remembers, per viewer, whether the sidebar is expanded or collapsed to icons (#222). */
export const SIDEBAR_OPEN_KEY = "casefile.sidebar.open";

/** The workspace view (ADR local-ui-stack). Every view reads the files again. */
export function App() {
  const route = useRoute();
  const [sidebarOpen, setSidebarOpen] = useStoredFlag(SIDEBAR_OPEN_KEY, true);
  const [overview, setOverview] = useState<Result<Overview> | null>(null);
  const [reload, setReload] = useState(0);
  /** The last case created here: its page names the commit until core derives it (#51). */
  const [created, setCreated] = useState<Covered | null>(null);
  // Said once, like an edit's commit: leaving the new case's page forgets it.
  useEffect(() => {
    setCreated((last) =>
      last !== null && route.view === "case" && last.created.some((c) => c.ref === route.ref)
        ? last
        : null,
    );
  }, [route]);

  // The page a case was opened from stays behind its Sheet: a case list (#146), a
  // milestone (#166) or a dashboard (#187). Any other view forgets it.
  const [pageBehind, setPageBehind] = useState<BehindRoute | null>(null);
  useEffect(() => {
    if (
      route.view === "cases" ||
      route.view === "dashboard" ||
      (route.view === "milestone" && !route.evidence)
    ) {
      setPageBehind(route);
    } else if (route.view !== "case") setPageBehind(null);
  }, [route]);

  const load = useCallback(() => {
    call<Overview>("overview").then(setOverview);
  }, []);
  useEffect(load, [load]);
  const refresh = () => {
    setCreated(null);
    load();
    setReload((n) => n + 1);
  };
  // A write in a case over a milestone or a dashboard changes its numbers: read both again.
  const written = () => {
    load();
    setReload((n) => n + 1);
  };

  const projects = overview?.ok ? overview.value.projects : [];
  // A case opened from a link or a reload: its own project and feature's list.
  const behind: BehindRoute | undefined =
    route.view === "cases" ||
    route.view === "dashboard" ||
    (route.view === "milestone" && !route.evidence)
      ? route
      : route.view === "case"
        ? (pageBehind ?? {
            view: "cases",
            project: route.ref.split("/")[0],
            feature: overview?.ok
              ? overview.value.cases.find((c) => c.ref === route.ref)?.feature
              : undefined,
          })
        : undefined;
  const list = behind?.view === "cases" ? behind : undefined;
  const milestone = behind?.view === "milestone" ? behind : undefined;
  const dashboard = behind?.view === "dashboard" ? behind : undefined;
  // Over a case, the header names the page behind it.
  const project = route.view === "case" ? behind?.project : route.project;
  const unresolved = projects
    .filter((p) => project === undefined || p.name === project)
    .reduce((sum, p) => sum + p.unresolved, 0);
  const tab = (view: ListView) => formatRoute({ view, project });
  // A case page or the new-case form is part of the case list, a milestone of the
  // Milestones view, a dashboard of Dashboards: switching project goes back to the list.
  const listOf = (view: Exclude<Route["view"], "case" | "new">): ListView =>
    view === "milestone" ? "milestones" : view === "dashboard" ? "dashboards" : view;
  const listView: ListView =
    route.view === "case"
      ? behind?.view === undefined || behind.view === "cases"
        ? "cases"
        : listOf(behind.view)
      : route.view === "new"
        ? "cases"
        : listOf(route.view);
  const onCreated = (covered: Covered) => {
    setCreated(covered);
    // The tree and the list read the workspace again, so the new case is in them.
    load();
    const ref = covered.created[0]?.ref;
    if (ref !== undefined) window.location.hash = formatRoute({ view: "case", ref });
  };

  const scope =
    project ??
    (projects.length === 1 ? projects[0]?.name : projects.length > 1 ? "All projects" : undefined);

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <AppSidebar projects={projects} project={project} listView={listView} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 print:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4!" />
          <p className="min-w-0 truncate text-sm">
            {scope === undefined ? null : <span className="text-muted-foreground">{scope} › </span>}
            <span className="font-medium">{VIEWS.find((v) => v.view === listView)?.label}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={refresh}
            aria-label="Read the files again"
          >
            <RefreshCw /> Refresh
          </Button>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-6 print:p-0">
          {overview === null ? (
            <Skeleton className="h-64 w-full" />
          ) : !overview.ok ? (
            <ErrorList errors={overview.errors} />
          ) : (
            <>
              {unresolved > 0 && list !== undefined ? (
                <p className="text-muted-foreground text-sm">
                  {unresolved} case {unresolved === 1 ? "file does" : "files do"} not resolve and
                  {unresolved === 1 ? " is" : " are"} not listed:{" "}
                  <a className="underline" href={tab("validate")}>
                    see Validate
                  </a>
                  .
                </p>
              ) : null}
              {route.view === "new" ? (
                <NewCase
                  key={`${route.project ?? ""}:${route.feature ?? ""}`}
                  projects={projects.map((p) => p.name)}
                  features={featuresByProject(overview.value)}
                  project={route.project}
                  feature={route.feature}
                  onCreated={onCreated}
                />
              ) : route.view === "milestones" ? (
                <Milestones
                  key={`${project ?? ""}:${reload}`}
                  project={project}
                  projects={projects.map((p) => p.name)}
                />
              ) : route.view === "milestone" && route.evidence ? (
                <EvidencePrint project={route.project} slug={route.slug} version={reload} />
              ) : milestone !== undefined ? (
                <MilestonePage
                  key={`${milestone.project}/${milestone.slug}`}
                  project={milestone.project}
                  slug={milestone.slug}
                  version={reload}
                  onWritten={load}
                />
              ) : route.view === "dashboards" ? (
                <Suspense fallback={<Skeleton className="h-40 w-full" />}>
                  <Dashboards
                    project={project}
                    projects={projects.map((p) => p.name)}
                    version={reload}
                  />
                </Suspense>
              ) : dashboard !== undefined ? (
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <DashboardPage
                    key={`${dashboard.project}/${dashboard.slug}`}
                    project={dashboard.project}
                    slug={dashboard.slug}
                    version={reload}
                  />
                </Suspense>
              ) : route.view === "query" ? (
                <QueryView key={project ?? ""} project={project} />
              ) : route.view === "validate" ? (
                <ValidateView key={reload} project={project} />
              ) : list !== undefined ? (
                // The same element for the list and for a case over it: the list is not
                // mounted again, so it keeps its scroll and what is folded in the tree.
                <CasesPage
                  overview={overview.value}
                  project={list.project}
                  feature={list.feature}
                  state={list.state}
                />
              ) : null}
              <CaseSheet
                caseRef={route.view === "case" ? route.ref : undefined}
                reload={reload}
                created={created}
                milestone={milestone?.slug}
                onWritten={milestone === undefined && dashboard === undefined ? load : written}
                onClose={() => {
                  if (behind !== undefined) window.location.hash = formatRoute(behind);
                }}
              />
            </>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * The viewer's navigation (#222): the project switcher when there is more than one
 * project, the views, and who the QA acts as. Collapses to icons; a narrow screen
 * opens it as a Sheet. Switching project keeps the list view, as the header did.
 */
function AppSidebar(props: {
  projects: Overview["projects"];
  project?: string;
  listView: ListView;
}) {
  const { projects, project, listView } = props;
  const { isMobile, setOpenMobile } = useSidebar();
  // On a narrow screen the Sheet would stay open over the page it just opened.
  const followed = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="casefile">
              <a href={formatRoute({ view: "cases" })} onClick={followed}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <FileCheck2 className="size-4" />
                </span>
                <span className="font-semibold tracking-tight">casefile</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* One project: there is nothing to switch to, and its count is the list itself. */}
          {projects.length > 1 ? (
            <SidebarMenuItem>
              <ProjectSwitcher
                projects={projects}
                project={project}
                listView={listView}
                onFollow={followed}
              />
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Views</SidebarGroupLabel>
          <nav aria-label="Views">
            <SidebarMenu>
              {VIEWS.map(({ view, label, icon: Icon }) => (
                <SidebarMenuItem key={view}>
                  <SidebarMenuButton asChild isActive={listView === view} tooltip={label}>
                    <a
                      href={formatRoute({ view, project })}
                      aria-current={listView === view ? "page" : undefined}
                      onClick={followed}
                    >
                      <Icon />
                      <span>{label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <ActingAs />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function ProjectSwitcher(props: {
  projects: Overview["projects"];
  project?: string;
  listView: ListView;
  onFollow: () => void;
}) {
  const { projects, project, listView, onFollow } = props;
  const { isMobile } = useSidebar();
  const choices = [
    { name: undefined, label: "All projects", cases: undefined },
    ...projects.map((p) => ({ name: p.name, label: p.name, cases: p.cases })),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <span className="flex aspect-square size-8 items-center justify-center rounded-lg border bg-background">
            <FolderGit2 className="size-4" />
          </span>
          <span className="grid flex-1 text-left leading-tight">
            <span className="text-muted-foreground text-xs">Project</span>
            <span className="truncate font-medium">{project ?? "All projects"}</span>
          </span>
          <ChevronsUpDown className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-56"
        align="start"
        side={isMobile ? "bottom" : "right"}
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-muted-foreground text-xs">Projects</DropdownMenuLabel>
        {choices.map((c) => (
          <DropdownMenuItem key={c.label} asChild>
            <a
              href={formatRoute({ view: listView, project: c.name })}
              aria-current={project === c.name ? "true" : undefined}
              onClick={onFollow}
            >
              <Check className={cn(project === c.name ? "opacity-100" : "opacity-0")} />
              {c.label}
              {c.cases === undefined ? null : (
                <span className="ml-auto text-muted-foreground tabular-nums">{c.cases}</span>
              )}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type CasesRoute = Extract<Route, { view: "cases" }>;
/** What a case's Sheet can slide over. */
type BehindRoute =
  | CasesRoute
  | Extract<Route, { view: "milestone" }>
  | Extract<Route, { view: "dashboard" }>;

/** Remembers, per viewer, whether the case list shows Automation and Last run (#110). */
export const RUN_COLUMNS_KEY = "casefile.caseList.runColumns";

function CasesPage(props: {
  overview: Overview;
  project?: string;
  feature?: string;
  state?: StateFilter;
}) {
  const { overview, project, feature, state } = props;
  const inProject = overview.cases.filter((c) => project === undefined || c.project === project);
  // A leaf feature keeps the plain table; all features or a parent group by feature (#112).
  const leaf = feature !== undefined && !inProject.some((c) => c.feature.startsWith(`${feature}/`));
  // Read over the project, not the feature: the columns do not come and go per feature.
  const everRan = inProject.some((c) => c.last_run !== null);
  const [runColumns, setRunColumns] = useStoredFlag(RUN_COLUMNS_KEY, true);
  const inScope = inProject.filter((c) => inFeature(c, feature));
  // The overview's `state` is the resolved case's, the field a `state = …` query compares.
  const listed = state === undefined ? inScope : inScope.filter((c) => c.state === state);
  const drafts = inScope.filter((c) => c.state === DRAFT).length;
  const draftsOnly = state === DRAFT;
  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0">
        <FeatureTree project={project} rows={inProject} selected={feature} state={state} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap justify-end gap-1">
          <Button asChild size="sm" className="mr-auto">
            <a href={formatRoute({ view: "new", project, feature })}>
              <Plus /> New case
            </a>
          </Button>
          <Button
            variant={draftsOnly ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={draftsOnly}
            onClick={() => {
              window.location.hash = formatRoute({
                view: "cases",
                project,
                feature,
                state: draftsOnly ? undefined : DRAFT,
              });
            }}
          >
            <FilePen />
            Drafts awaiting review
            <Badge variant={drafts > 0 ? "default" : "outline"} className="tabular-nums">
              {drafts}
            </Badge>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRunColumns(!runColumns)}>
            {runColumns ? <EyeOff /> : <Eye />}
            {runColumns ? "Hide automation and runs" : "Show automation and runs"}
          </Button>
        </div>
        <CaseList
          rows={listed}
          grouped={!leaf}
          project={project}
          state={state}
          emptyText={draftsOnly ? "No drafts await review here." : undefined}
          showAutomation={runColumns}
          showLastRun={runColumns && everRan}
        />
      </section>
    </div>
  );
}

/** Each project's features, parents included, in tree order: what a new case can go under. */
function featuresByProject(overview: Overview): Map<string, string[]> {
  const byProject = new Map<string, Set<string>>();
  for (const row of overview.cases) {
    const features = byProject.get(row.project) ?? new Set<string>();
    const parts = row.feature.split("/");
    parts.forEach((_, i) => {
      features.add(parts.slice(0, i + 1).join("/"));
    });
    byProject.set(row.project, features);
  }
  return new Map(
    [...byProject].map(([project, features]) => [project, [...features].sort(compareFeatures)]),
  );
}
