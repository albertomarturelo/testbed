import { posix } from "node:path";
import { z } from "zod";
import { fail, ok } from "../errors.js";
import { nextCaseId } from "../ids.js";
import { TESTS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { selectProject } from "./cases.js";
import { defineOperation } from "./operation.js";

const IdNextInput = z.strictObject({
  /** The project the id is for; filled by the host. Required with several projects. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const IdNextOutput = z.strictObject({ project: z.string(), id: z.string() });

/** A case file name: `.../TC-0003.md` → `TC-0003`. */
const CASE_FILE = /(?:^|\/)(TC-[0-9]{4,})\.md$/;

/**
 * `casefile id next`: the next free case id of a project (ids are unique per
 * project, ADR workspace-and-projects §5). Read-only: it reserves nothing.
 * Case files that do not parse still hold their id.
 */
export const idNextOperation = defineOperation({
  name: "id-next",
  input: IdNextInput,
  output: IdNextOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/id-next.md",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const selected = selectProject(workspace, input.project);
    if (!selected.ok) return selected;
    let project = selected.value;
    if (project === null) {
      if (workspace.projects.length !== 1) {
        const names = workspace.projects.map((p) => p.name).join(", ") || "none";
        return fail({
          code: "project.required",
          field: "project",
          message: `ids are per project and this workspace has ${workspace.projects.length} (${names}): pass --project <name> or run inside one`,
        });
      }
      project = workspace.projects[0] as NonNullable<typeof project>;
    }
    const tests = posix.join(project.path, TESTS_DIR);
    const unparsed = workspace.errors
      .map((e) => e.path ?? "")
      .filter((path) => path.startsWith(`${tests}/`))
      .flatMap((path) => CASE_FILE.exec(path)?.slice(1) ?? []);
    const id = nextCaseId([...project.cases.map((c) => c.file.id), ...unparsed]);
    return ok({ project: project.name, id });
  },
});
