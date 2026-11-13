/**
 * Views live in the URL hash (ADR local-ui-stack §4): `#/cases?project=web&feature=login`
 * (`&state=draft` lists only the drafts awaiting review, #87; no other state is a filter),
 * `#/case/web/TC-0001` (the case in a Sheet over the list it was opened from, else its
 * feature's, #146), `#/new?project=web&feature=login` (create a case there, #94),
 * `#/query`, `#/validate`, `#/milestones?project=web` (#166),
 * `#/milestone/web/web-2.1.0` (one milestone; a case opened from it slides over it)
 * and `#/milestone/web/web-2.1.0/evidence` (its printable evidence),
 * `#/dashboards?project=web` and `#/dashboard/web/overview` (one dashboard; a case
 * opened from one of its tables slides over it, #187). A reload keeps the view.
 */
export type Route =
  | { view: "cases"; project?: string; feature?: string; state?: StateFilter }
  | { view: "case"; ref: string }
  | { view: "new"; project?: string; feature?: string }
  | { view: "query"; project?: string }
  | { view: "validate"; project?: string }
  | { view: "milestones"; project?: string }
  | { view: "milestone"; project: string; slug: string; evidence?: boolean }
  | { view: "dashboards"; project?: string }
  | { view: "dashboard"; project: string; slug: string };

/** The state the "drafts awaiting review" filter lists: what a `state = draft` query matches. */
export const DRAFT = "draft";
export type StateFilter = typeof DRAFT;

export function parseRoute(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(search);
  const project = params.get("project") ?? undefined;
  const [view, ...rest] = path.split("/");
  if (view === "case" && rest.length > 0) return { view: "case", ref: rest.join("/") };
  if (view === "new") return { view: "new", project, feature: params.get("feature") ?? undefined };
  if (view === "query") return { view: "query", project };
  if (view === "validate") return { view: "validate", project };
  if (view === "milestones") return { view: "milestones", project };
  if (view === "dashboards") return { view: "dashboards", project };
  const [pageProject, slug, page, ...extra] = rest;
  if (view === "dashboard" && pageProject && slug && page === undefined) {
    return { view: "dashboard", project: pageProject, slug };
  }
  if (view === "milestone" && pageProject && slug && extra.length === 0) {
    if (page === undefined) return { view: "milestone", project: pageProject, slug };
    if (page === "evidence") {
      return { view: "milestone", project: pageProject, slug, evidence: true };
    }
  }
  return {
    view: "cases",
    project,
    feature: params.get("feature") ?? undefined,
    // Only the filter the page offers: any other value would filter with nothing on screen saying so.
    state: params.get("state") === DRAFT ? DRAFT : undefined,
  };
}

export function formatRoute(route: Route): string {
  if (route.view === "case") return `#/case/${route.ref}`;
  if (route.view === "dashboard") return `#/dashboard/${route.project}/${route.slug}`;
  if (route.view === "milestone") {
    return `#/milestone/${route.project}/${route.slug}${route.evidence ? "/evidence" : ""}`;
  }
  const params = new URLSearchParams();
  if (route.project !== undefined) params.set("project", route.project);
  if ((route.view === "cases" || route.view === "new") && route.feature !== undefined) {
    params.set("feature", route.feature);
  }
  if (route.view === "cases" && route.state !== undefined) params.set("state", route.state);
  const search = params.toString();
  return `#/${route.view}${search === "" ? "" : `?${search}`}`;
}
