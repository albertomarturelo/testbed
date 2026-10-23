import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { call, type Overview, type Result, type Session, session } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { FeatureTree, inFeature } from "@/components/FeatureTree";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoredFlag } from "@/lib/stored";
import { cn } from "@/lib/utils";
import { formatRoute, parseRoute, type Route } from "@/route";
import { CaseDetail } from "@/views/CaseDetail";
import { CaseList } from "@/views/CaseList";
import { QueryView } from "@/views/QueryView";
import { ValidateView } from "@/views/ValidateView";

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
  return identity === null ? (
    <span className="text-xs text-destructive">
      No identity: set CASEFILE_USER_EMAIL or git config user.email to write
    </span>
  ) : (
    <span className="text-xs text-muted-foreground" title={SOURCES[identity.source]}>
      Acting as {identity.name ? `${identity.name} <${identity.email}>` : identity.email}
    </span>
  );
}

/** The workspace view (ADR local-ui-stack). Every view reads the files again. */
export function App() {
  const route = useRoute();
  const [overview, setOverview] = useState<Result<Overview> | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(() => {
    call<Overview>("overview").then(setOverview);
  }, []);
  useEffect(load, [load]);
  const refresh = () => {
    load();
    setReload((n) => n + 1);
  };

  const project = route.view === "case" ? route.ref.split("/")[0] : route.project;
  const projects = overview?.ok ? overview.value.projects : [];
  const unresolved = projects
    .filter((p) => project === undefined || p.name === project)
    .reduce((sum, p) => sum + p.unresolved, 0);
  const tab = (view: "cases" | "query" | "validate") => formatRoute({ view, project });

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b px-6 py-3">
        <a href="#/cases" className="font-semibold tracking-tight">
          casefile
        </a>
        {/* One project: there is nothing to switch to, and its count is the list itself. */}
        {projects.length > 1 ? (
          <>
            <Separator orientation="vertical" className="h-5!" />
            <nav aria-label="Projects" className="flex flex-wrap gap-1 text-sm">
              <ProjectLink
                href={formatRoute({
                  view: route.view === "case" ? "cases" : route.view,
                  project: undefined,
                })}
                active={project === undefined}
              >
                All projects
              </ProjectLink>
              {projects.map((p) => (
                <ProjectLink
                  key={p.name}
                  href={formatRoute({
                    view: route.view === "case" ? "cases" : route.view,
                    project: p.name,
                  })}
                  active={project === p.name}
                >
                  {p.name} <span className="text-muted-foreground">· {p.cases}</span>
                </ProjectLink>
              ))}
            </nav>
          </>
        ) : null}
        <nav aria-label="Views" className="ml-auto flex gap-1 text-sm">
          <ProjectLink href={tab("cases")} active={route.view === "cases" || route.view === "case"}>
            Cases
          </ProjectLink>
          <ProjectLink href={tab("query")} active={route.view === "query"}>
            Query
          </ProjectLink>
          <ProjectLink href={tab("validate")} active={route.view === "validate"}>
            Validate
          </ProjectLink>
        </nav>
        <ActingAs />
        <Button variant="outline" size="sm" onClick={refresh} aria-label="Read the files again">
          <RefreshCw /> Refresh
        </Button>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-6">
        {overview === null ? (
          <Skeleton className="h-64 w-full" />
        ) : !overview.ok ? (
          <ErrorList errors={overview.errors} />
        ) : (
          <>
            {unresolved > 0 && route.view === "cases" ? (
              <p className="text-muted-foreground text-sm">
                {unresolved} case {unresolved === 1 ? "file does" : "files do"} not resolve and
                {unresolved === 1 ? " is" : " are"} not listed:{" "}
                <a className="underline" href={tab("validate")}>
                  see Validate
                </a>
                .
              </p>
            ) : null}
            {route.view === "case" ? (
              <CaseDetail key={`${route.ref}:${reload}`} caseRef={route.ref} />
            ) : route.view === "query" ? (
              <QueryView key={project ?? ""} project={project} />
            ) : route.view === "validate" ? (
              <ValidateView key={reload} project={project} />
            ) : (
              <CasesPage overview={overview.value} project={project} feature={route.feature} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** Remembers, per viewer, whether the case list shows Automation and Last run (#110). */
export const RUN_COLUMNS_KEY = "casefile.caseList.runColumns";

function CasesPage(props: { overview: Overview; project?: string; feature?: string }) {
  const { overview, project, feature } = props;
  const inProject = overview.cases.filter((c) => project === undefined || c.project === project);
  // A leaf feature: every listed case is in it, so the Feature column would only repeat it.
  const leaf = feature !== undefined && !inProject.some((c) => c.feature.startsWith(`${feature}/`));
  // Read over the project, not the feature: the columns do not come and go per feature.
  const everRan = inProject.some((c) => c.last_run !== null);
  const [runColumns, setRunColumns] = useStoredFlag(RUN_COLUMNS_KEY, true);
  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0">
        <FeatureTree project={project} rows={inProject} selected={feature} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setRunColumns(!runColumns)}>
            {runColumns ? <EyeOff /> : <Eye />}
            {runColumns ? "Hide automation and runs" : "Show automation and runs"}
          </Button>
        </div>
        <CaseList
          rows={inProject.filter((c) => inFeature(c, feature))}
          showFeature={!leaf}
          showAutomation={runColumns}
          showLastRun={runColumns && everRan}
        />
      </section>
    </div>
  );
}

function ProjectLink(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={props.href}
      className={cn(
        "rounded-md px-2.5 py-1 hover:bg-accent",
        props.active && "bg-accent font-medium",
      )}
    >
      {props.children}
    </a>
  );
}
