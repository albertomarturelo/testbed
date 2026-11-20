import { posix } from "node:path";
import type { CasefileError } from "../errors.js";
import { DASHBOARDS_DIR } from "../load/paths.js";
import type { LoadedProject } from "../load/workspace.js";

/** `context/dashboards/<slug>.yaml` of a project (ADR dashboards-as-files §1). */
export function dashboardPath(project: LoadedProject, slug: string): string {
  return posix.join(project.path, DASHBOARDS_DIR, `${slug}.yaml`);
}

/** `dashboard.unknown`, naming the dashboards the project does have. */
export function unknownDashboard(project: LoadedProject, slug: string): CasefileError {
  const known = [...project.dashboards.keys()].sort();
  return {
    code: "dashboard.unknown",
    field: "slug",
    message: `${project.name} has no dashboard '${slug}'${
      known.length === 0 ? "" : ` (it has: ${known.join(", ")})`
    }`,
  };
}
