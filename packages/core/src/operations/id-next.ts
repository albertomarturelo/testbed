import { z } from "zod";
import { fail, ok } from "../errors.js";
import { nextCaseId } from "../ids.js";
import { loadWorkspace } from "../load/workspace.js";
import { requireProject, takenIds } from "./cases.js";
import { defineOperation } from "./operation.js";

const IdNextInput = z.strictObject({
  /** The project the id is for; filled by the host. Required with several projects. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const IdNextOutput = z.strictObject({ project: z.string(), id: z.string() });

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
    const project = requireProject(workspace, input.project);
    if (!project.ok) return project;
    return ok({ project: project.value.name, id: nextCaseId(takenIds(workspace, project.value)) });
  },
});
