import { z } from "zod";
import { fail, ok } from "../errors.js";
import { normalizeProjectPath, pathContains } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { validateWorkspace } from "../validate/validate.js";
import { extensionLayers, loadExtensions, loadToolchain } from "./extensions.js";
import { defineOperation } from "./operation.js";

const ValidateInput = z.strictObject({
  /** Only this project's findings, plus the workspace-level ones. Filled by the host. */
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const FindingOutput = z.looseObject({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  path: z.string(),
  message: z.string(),
});

const ValidateOutput = z.strictObject({
  /** Projects checked. */
  projects: z.number().int(),
  /** Case files loaded in those projects. */
  cases: z.number().int(),
  warnings: z.number().int(),
  /** Only warnings: any error fails the operation with every finding. */
  findings: z.array(FindingOutput),
});

/**
 * `casefile validate` (ADR agent-driven-setup, point 5): the oracle of the setup
 * loop. Read-only. With no errors it succeeds (warnings allowed); with any error
 * it fails with every finding, so hosts exit 1.
 */
export const validateOperation = defineOperation({
  name: "validate",
  input: ValidateInput,
  output: ValidateOutput,
  actor: ["human", "agent", "ci"],
  writes: [],
  spec: "specs/validate.md",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    const names = workspace.config?.extensions ?? [];
    const toolchain = await loadToolchain(context.root, names);
    const { extensions } = await loadExtensions(context.root, names);
    let findings = validateWorkspace({
      workspace,
      toolchain,
      extensionLayers: extensionLayers(extensions),
    });
    let projects = workspace.projects;

    // Without a readable casefile.yaml there are no projects to select: its
    // findings are the task, so they come back unfiltered.
    if (input.project !== undefined && workspace.config !== null) {
      const entries = workspace.config.projects;
      const entry = entries.find((p) => p.name === input.project);
      if (entry === undefined) {
        return fail({
          code: "project.unknown",
          field: "project",
          message: `no project named '${input.project}' in casefile.yaml`,
        });
      }
      const own = normalizeProjectPath(entry.path);
      const dirs = entries.map((p) => normalizeProjectPath(p.path));
      findings = findings.filter(
        (f) => pathContains(own, f.path) || !dirs.some((dir) => pathContains(dir, f.path)),
      );
      projects = projects.filter((p) => p.name === input.project);
    }

    if (findings.some((f) => f.severity === "error")) return fail(...findings);
    return ok({
      projects: projects.length,
      cases: projects.reduce((sum, p) => sum + p.cases.length, 0),
      warnings: findings.length,
      findings,
    });
  },
});
