import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";
import { type CasefileError, fail, ok } from "../errors.js";
import { nextCaseId } from "../ids.js";
import { TESTS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import {
  type CommonsLayer,
  commonsChain,
  resolveCase,
  workspaceLayer,
} from "../resolve/resolve.js";
import { FeatureSlug, TestCaseFile } from "../schema/index.js";
import {
  CaseTitle,
  caseText,
  normalizeTitle,
  WriteCommit,
  WriterInput,
  writeCommit,
  writtenBy,
} from "./case-file.js";
import { requireProject, takenIds } from "./cases.js";
import { extensionLayers, loadExtensions } from "./extensions.js";
import { defineOperation } from "./operation.js";

/**
 * The case fields the caller decides (`casefile spec cover`). `id`, `feature`,
 * `state`, `origin` and `history` are casefile's; `automation.status` is never
 * stored as `automated` (ADR write-ownership), so only `eligible` and `ref`.
 */
const ProposedCase = TestCaseFile.pick({
  acceptance_ref: true,
  surfaces: true,
  layer: true,
  priority: true,
  labels: true,
  preconditions: true,
  data: true,
  steps: true,
  work_items: true,
  duplicates_checked_against: true,
}).extend({
  title: CaseTitle,
  automation: z
    .strictObject({ eligible: z.boolean().optional(), ref: z.string().min(1).optional() })
    .optional(),
  /** Markdown body of the file, below the frontmatter. */
  notes: z.string().optional(),
});

const CoverInput = z.strictObject({
  /** Where the cases go: `<project>/context/tests/<feature>/`. */
  feature: FeatureSlug,
  cases: z.array(ProposedCase).min(1),
  ...WriterInput,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const CoverOutput = z.strictObject({
  project: z.string(),
  feature: z.string(),
  change: z.string(),
  created: z.array(z.strictObject({ ref: z.string(), path: z.string() })),
  commit: WriteCommit,
  next: z.array(z.string()),
});

/**
 * `casefile cover <feature> --cases '<json>'` (ADR agent-driven-setup: the agent
 * decides, the library writes). Writes the proposed cases as `draft` files with
 * fresh ids and one `history` entry sharing one change id, all or nothing, and
 * returns the commit for the caller to run (ADR agent-runs-the-commit). A human
 * creates cases too, from the viewer (ADR human-writes-through-operations).
 */
export const coverOperation = defineOperation({
  name: "cover",
  input: CoverInput,
  output: CoverOutput,
  actor: ["agent", "human"],
  writes: [`**/${TESTS_DIR}/**/TC-*.md`],
  spec: "specs/cover.md",
  subject: "feature",
  async run(input, context) {
    const writer = writtenBy("cover", context.actor, input);
    if (!writer.ok) return writer;
    const { by, agent } = writer.value;
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;

    const featureDir = posix.join(project.path, TESTS_DIR, input.feature);
    const { extensions } = await loadExtensions(context.root, workspace.config.extensions ?? []);
    const outer = [...extensionLayers(extensions), ...workspaceLayer(workspace.config)];
    const layers = [
      ...outer,
      ...commonsChain(project.commons, project.path, `${featureDir}/TC-0000.md`),
    ];

    const errors: CasefileError[] = [];
    const maxBatch = innermost(layers, (c) => c.review?.max_batch);
    if (maxBatch !== undefined && input.cases.length > maxBatch) {
      errors.push({
        code: "cover.batch_too_large",
        field: "cases",
        message: `${input.cases.length} cases in one call; the commons of '${input.feature}' allow ${maxBatch} (review.max_batch): propose the rest after the review`,
      });
    }

    const titles = new Map(
      project.cases
        .filter((c) => posix.dirname(c.path) === featureDir)
        .map((c) => [normalizeTitle(c.file.title), c.file.id]),
    );
    const declared = project.properties?.properties ?? {};
    const change = randomUUID();
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const taken = takenIds(workspace, project);
    const files: { ref: string; path: string; text: string }[] = [];

    for (const [index, proposed] of input.cases.entries()) {
      const field = (name: string) => `cases.${index}.${name}`;
      const key = normalizeTitle(proposed.title);
      const clash = titles.get(key);
      if (clash !== undefined) {
        errors.push({
          code: "cover.duplicate_title",
          field: field("title"),
          message: `'${proposed.title}' is already the title of ${clash} in '${input.feature}' (a retry? commit the files of the first call)`,
        });
      }
      for (const label of Object.keys(proposed.labels ?? {})) {
        if (Object.hasOwn(declared, label)) continue;
        errors.push({
          code: "label.undeclared",
          field: field(`labels.${label}`),
          message: `label '${label}' is not declared in ${posix.join(project.path, TESTS_DIR, "_properties.yaml")}`,
        });
      }

      const id = nextCaseId(taken);
      taken.push(id);
      titles.set(key, id);
      const { notes, ...fields } = proposed;
      const file = TestCaseFile.parse({
        id,
        feature: input.feature,
        state: "draft",
        origin: agent === undefined ? "human" : "agent",
        ...fields,
        history: [
          {
            at,
            by,
            via: input.via,
            change,
            ...(input.inbox === undefined ? {} : { inbox: input.inbox }),
            event: "created",
          },
        ],
      });
      const path = `${featureDir}/${id}.md`;
      const resolved = resolveCase(
        { path, file, body: notes ?? "" },
        {
          project: project.name,
          layers: [...outer, ...commonsChain(project.commons, project.path, path)],
          runs: [],
          commitFor: () => null,
        },
      );
      if (!resolved.ok) {
        errors.push(
          ...resolved.errors.map(({ path: _, ...error }) => ({
            ...error,
            field: field(error.field ?? ""),
            message: `${error.message}: set it in the case, or finish the commons (\`casefile spec setup\`)`,
          })),
        );
      }
      if (await context.exists(path)) {
        errors.push({
          code: "cover.file_exists",
          path,
          message: `${path} exists but does not parse as a case, so its id looked free: fix or remove it, then run cover again`,
        });
      }
      files.push({ ref: `${project.name}/${id}`, path, text: caseText(file, notes) });
    }
    if (errors.length > 0) return fail(...errors);

    for (const { path, text } of files) await context.writeText(path, text);
    const count = files.length;
    const refs = files.map((f) => f.ref).join(", ");
    return ok({
      project: project.name,
      feature: input.feature,
      change,
      created: files.map(({ ref, path }) => ({ ref, path })),
      commit: writeCommit(
        `cover(${input.feature}): propose ${count} ${count === 1 ? "case" : "cases"}`,
        { requestedBy: by, inbox: input.inbox, agent, change },
        files.map((f) => f.path),
      ),
      next:
        agent === undefined
          ? [
              `Commit the created files with commit.message taken from --json output, as yourself, staging only them (\`git commit -F <message> -- <paths>\`)`,
              `Review and approve the drafts: ${refs}`,
            ]
          : [
              `Commit the created files with commit.author and commit.message taken from --json output, staging only them (\`git commit -F <message> -- <paths>\`)`,
              `Ask the human to review the drafts: ${refs}`,
            ],
    });
  },
});

/** The value set by the commons closest to the case, if any sets it. */
function innermost<T>(
  layers: readonly CommonsLayer[],
  pick: (commons: CommonsLayer["commons"]) => T | undefined,
): T | undefined {
  let found: T | undefined;
  for (const { commons } of layers) found = pick(commons) ?? found;
  return found;
}
