import { posix } from "node:path";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import { TESTS_DIR } from "../load/paths.js";
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

/**
 * The one project an operation acts on: `name`, else the only project. Ids are
 * per project (ADR workspace-and-projects §5), so several projects and no name
 * is `project.required`.
 */
export function requireProject(
  workspace: LoadedWorkspace,
  name: string | undefined,
): Result<LoadedProject> {
  const selected = selectProject(workspace, name);
  if (!selected.ok) return selected;
  if (selected.value !== null) return ok(selected.value);
  const [only] = workspace.projects;
  if (workspace.projects.length === 1 && only !== undefined) return ok(only);
  const names = workspace.projects.map((p) => p.name).join(", ") || "none";
  return fail({
    code: "project.required",
    field: "project",
    message: `ids are per project and this workspace has ${workspace.projects.length} (${names}): pass --project <name> or run inside one`,
  });
}

/** A case file name: `.../TC-0003.md` → `TC-0003`. */
const CASE_FILE = /(?:^|\/)(TC-[0-9]{4,})\.md$/;

/** Ids a project already uses, including case files that do not parse: they still hold theirs. */
export function takenIds(workspace: LoadedWorkspace, project: LoadedProject): string[] {
  const tests = posix.join(project.path, TESTS_DIR);
  const unparsed = workspace.errors
    .map((e) => e.path ?? "")
    .filter((path) => path.startsWith(`${tests}/`))
    .flatMap((path) => CASE_FILE.exec(path)?.slice(1) ?? []);
  return [...project.cases.map((c) => c.file.id), ...unparsed];
}
