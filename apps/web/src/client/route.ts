/**
 * Views live in the URL hash (ADR local-ui-stack §4): `#/cases?project=web&feature=login`
 * (`&state=draft` lists only the cases in that state, #87),
 * `#/case/web/TC-0001`, `#/query`, `#/validate`. A reload keeps the view.
 */
export type Route =
  | { view: "cases"; project?: string; feature?: string; state?: string }
  | { view: "case"; ref: string }
  | { view: "query"; project?: string }
  | { view: "validate"; project?: string };

export function parseRoute(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(search);
  const project = params.get("project") ?? undefined;
  const [view, ...rest] = path.split("/");
  if (view === "case" && rest.length > 0) return { view: "case", ref: rest.join("/") };
  if (view === "query") return { view: "query", project };
  if (view === "validate") return { view: "validate", project };
  return {
    view: "cases",
    project,
    feature: params.get("feature") ?? undefined,
    state: params.get("state") ?? undefined,
  };
}

export function formatRoute(route: Route): string {
  if (route.view === "case") return `#/case/${route.ref}`;
  const params = new URLSearchParams();
  if (route.project !== undefined) params.set("project", route.project);
  if (route.view === "cases" && route.feature !== undefined) params.set("feature", route.feature);
  if (route.view === "cases" && route.state !== undefined) params.set("state", route.state);
  const search = params.toString();
  return `#/${route.view}${search === "" ? "" : `?${search}`}`;
}
