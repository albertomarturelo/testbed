import { type CasefileError, fail, ok, type Result } from "../errors.js";
import { type LoadedProject, type LoadedWorkspace, loadWorkspace } from "../load/workspace.js";
import { type ResolvedWorkspace, resolveWorkspace } from "../resolve/resolve.js";
import { extensionLayers, loadExtensions } from "./extensions.js";

/** A workspace as read-only operations see it: loaded, then resolved. */
export type WorkspaceCases = { workspace: LoadedWorkspace; resolved: ResolvedWorkspace };

/**
 * Filesystem adapter for read-only operations (`resolve`, `query`, `id next`):
 * loads the workspace and its extensions' commons and resolves every case.
 * Without a readable `casefile.yaml` there is nothing to resolve: its errors
 * come back, and `casefile validate` explains them.
 */
export async function loadWorkspaceCases(root: string): Promise<Result<WorkspaceCases>> {
  const workspace = await loadWorkspace(root);
  if (workspace.config === null) return fail(...workspace.errors);
  const { extensions } = await loadExtensions(root, workspace.config.extensions ?? []);
  const resolved = resolveWorkspace(workspace, {
    // Commit lookup arrives with the git adapter (#51); until then it is unknown.
    commitFor: () => null,
    extensionLayers: extensionLayers(extensions),
  });
  return ok({ workspace, resolved });
}

/** The project named `name`, `null` for every project when `name` is absent. */
export function selectProject(
  workspace: LoadedWorkspace,
  name: string | undefined,
): Result<LoadedProject | null> {
  if (name === undefined) return ok(null);
  const project = workspace.projects.find((p) => p.name === name);
  return project === undefined ? fail(unknownProject(name)) : ok(project);
}

export function unknownProject(name: string): CasefileError {
  return {
    code: "project.unknown",
    field: "project",
    message: `no project named '${name}' in casefile.yaml`,
  };
}
