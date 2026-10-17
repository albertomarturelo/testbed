import { isAbsolute, posix } from "node:path";
import { parseDocument, type YAMLSeq } from "yaml";
import { z } from "zod";
import { type CasefileError, fail, ok } from "../errors.js";
import { validate } from "../load/parse.js";
import { CONFIG_FILE, normalizeProjectPath, pathContains, TESTS_DIR } from "../load/paths.js";
import { Layer, Priority, ProjectEntry, ReviewMode, Surface } from "../schema/index.js";
import { defineOperation } from "./operation.js";
import { writeIfAbsent } from "./write-if-absent.js";

const ProjectAddInput = ProjectEntry;

const ProjectAddOutput = z.strictObject({
  name: z.string(),
  /** Normalized, as stored in `casefile.yaml`. */
  path: z.string(),
  /** Workspace-relative files written by this run; empty on a repeat. */
  created: z.array(z.string()),
});

/**
 * Only what `project add` relies on; the rest of `casefile.yaml` (commons,
 * extensions, even `TODO` markers) is the validator's business (#9).
 */
const ConfigProjects = z.object({ version: z.literal(1), projects: z.array(ProjectEntry) });

const allowed = (options: readonly string[]) => options.join(", ");

/**
 * Every field needs a decision, so each holds the `TODO` marker with its allowed
 * values (ADR agent-driven-setup, point 4), taken from the schema enums so the
 * comments cannot drift. The field list is in `specs/project-add.md`.
 */
export const COMMON_SCAFFOLD = `# Project-wide defaults for every case under this directory (\`casefile spec commons\`).
# Replace each TODO with a decision; \`casefile validate\` lists the ones left.

# Surfaces the product runs on, a non-empty list of:
#   ${allowed(Surface.options)}
surfaces: TODO

# Default test layer: ${allowed(Layer.options)}
layer: TODO

# Default priority: ${allowed(Priority.options)}
priority: TODO

automation:
  # Whether cases may be automated by default: true, false
  eligible: TODO

review:
  # How proposed cases are reviewed: ${allowed(ReviewMode.options)}
  mode: TODO
`;

/** `.runs/` and `.inbox/` start empty; Git keeps a directory only with a file in it. */
const KEEP = ".gitkeep";

/**
 * `casefile project add <name> --path <path>` (ADR agent-driven-setup, cli-generic-host): registers a
 * project in `casefile.yaml`, keeping its comments and key order, and scaffolds
 * `<path>/context/tests/`. Same arguments again is a no-op; a name or path that
 * clashes with another project is an error value.
 */
export const projectAddOperation = defineOperation({
  name: "project-add",
  input: ProjectAddInput,
  output: ProjectAddOutput,
  actor: ["agent"],
  writes: [
    CONFIG_FILE,
    `**/${TESTS_DIR}/_common.yaml`,
    `**/${TESTS_DIR}/.runs/${KEEP}`,
    `**/${TESTS_DIR}/.inbox/${KEEP}`,
  ],
  spec: "specs/project-add.md",
  subject: "name",
  async run(input, context) {
    const { name } = input;
    const path = normalizeProjectPath(input.path);
    if (isAbsolute(input.path) || path === ".." || path.startsWith("../")) {
      return fail({
        code: "project.outside_workspace",
        field: "path",
        message: `project path ${input.path} is not inside the workspace`,
      });
    }

    const text = await context.readText(CONFIG_FILE);
    if (text === null) {
      return fail({
        code: "config.missing",
        path: CONFIG_FILE,
        message: "casefile.yaml not found at the workspace root; the human runs `casefile init`",
      });
    }
    const doc = parseDocument(text, { schema: "core" });
    if (doc.errors.length > 0) {
      return fail(
        ...doc.errors.map(
          (error): CasefileError => ({
            code: "yaml.invalid",
            path: CONFIG_FILE,
            message: error.message.split("\n")[0] ?? error.message,
            ...(error.linePos ? { line: error.linePos[0].line } : {}),
          }),
        ),
      );
    }
    const config = validate(ConfigProjects, CONFIG_FILE, doc.toJS());
    if (!config.ok) return config;

    const clash = clashes(config.value.projects, name, path);
    if (clash.length > 0) return fail(...clash);
    const registered = config.value.projects.some(
      (p) => p.name === name && normalizeProjectPath(p.path) === path,
    );
    if (path !== "." && !(await context.exists(path))) {
      return fail({
        code: "project.missing",
        field: "path",
        message: `project path ${path} is not a directory of the workspace`,
      });
    }

    const created: string[] = [];
    if (!registered) {
      // Validated above as a list. `projects: []` from `init` is a flow
      // sequence; entries read better as a block.
      const seq = doc.get("projects", true) as YAMLSeq;
      seq.flow = false;
      seq.items.push(doc.createNode({ name, path }));
      await context.writeText(CONFIG_FILE, doc.toString());
      created.push(CONFIG_FILE);
    }
    const tests = posix.join(path, TESTS_DIR);
    const scaffold: [string, string][] = [
      [`${tests}/_common.yaml`, COMMON_SCAFFOLD],
      [`${tests}/.runs/${KEEP}`, ""],
      [`${tests}/.inbox/${KEEP}`, ""],
    ];
    for (const [file, content] of scaffold) {
      if (await writeIfAbsent(context, file, content)) created.push(file);
    }
    return ok({ name, path, created });
  },
});

/** Name taken by another path, path taken by another name, or nested projects. */
function clashes(projects: readonly ProjectEntry[], name: string, path: string): CasefileError[] {
  const errors: CasefileError[] = [];
  for (const [index, project] of projects.entries()) {
    const other = normalizeProjectPath(project.path);
    const at = { path: CONFIG_FILE, field: `projects.${index}` };
    if (project.name === name && other !== path) {
      errors.push({
        code: "project.name_taken",
        ...at,
        message: `project '${name}' is already registered at ${other}`,
      });
    } else if (project.name !== name && other === path) {
      errors.push({
        code: "project.path_taken",
        ...at,
        message: `${path} is already registered as project '${project.name}'`,
      });
    } else if (other !== path && (pathContains(other, path) || pathContains(path, other))) {
      errors.push({
        code: "project.nested",
        ...at,
        message: `projects do not nest: ${path} and '${project.name}' at ${other}`,
      });
    }
  }
  return errors;
}
