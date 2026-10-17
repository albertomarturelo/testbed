/**
 * Views live in the URL hash (ADR local-ui-stack §4): `#/cases?project=web&feature=login`,
 * `#/case/web/TC-0001`, `#/query`, `#/validate`. A reload keeps the view.
 */
export type Route =
  | { view: "cases"; project?: string; feature?: string }
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
  return { view: "cases", project, feature: params.get("feature") ?? undefined };
}

export function formatRoute(route: Route): string {
  if (route.view === "case") return `#/case/${route.ref}`;
  const params = new URLSearchParams();
  if (route.project !== undefined) params.set("project", route.project);
  if (route.view === "cases" && route.feature !== undefined) params.set("feature", route.feature);
  const search = params.toString();
  return `#/${route.view}${search === "" ? "" : `?${search}`}`;
}
