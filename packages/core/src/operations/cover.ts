import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { Document, isScalar, isSeq, Scalar, visit } from "yaml";
import { z } from "zod";
import { type CasefileError, fail, ok } from "../errors.js";
import { AGENT_AUTHOR, commitMessage } from "../git/trailers.js";
import { nextCaseId } from "../ids.js";
import { TESTS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import {
  type CommonsLayer,
  commonsChain,
  resolveCase,
  workspaceLayer,
} from "../resolve/resolve.js";
import { Email, FeatureSlug, TestCaseFile } from "../schema/index.js";
import { requireProject, takenIds } from "./cases.js";
import { extensionLayers, loadExtensions } from "./extensions.js";
import { defineOperation } from "./operation.js";

/**
 * The case fields the agent decides (`casefile spec cover`). `id`, `feature`,
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
  /** One line: titles are listed in tables (CLI, UI). */
  title: z.string().regex(/^[^\r\n]+$/, "one line, no line breaks"),
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
  /** The human who asked; `history[].by` and the `Requested-by:` trailer. */
  requestedBy: Email,
  /** The agent proposing them; the `Agent:` trailer. */
  agent: z.string().min(1),
  /** The inbox item the request came from; `history[].inbox` and `Inbox-Id:`. */
  inbox: z.string().min(1).optional(),
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const CoverOutput = z.strictObject({
  project: z.string(),
  feature: z.string(),
  change: z.string(),
  created: z.array(z.strictObject({ ref: z.string(), path: z.string() })),
  commit: z.strictObject({ author: z.string(), message: z.string() }),
  next: z.array(z.string()),
});

/** Frontmatter keys casefile writes, in this order; the rest follow schema order. */
const OWN_KEYS = ["id", "feature", "title", "state", "origin"] as const;

/** Lists of short tokens read better on one line: `surfaces: [web]`. */
const FLOW_LISTS = new Set(["surfaces", "work_items", "duplicates_checked_against"]);

/**
 * `casefile cover <feature> --cases '<json>'` (ADR agent-driven-setup: the agent
 * decides, the library writes). Writes the proposed cases as `draft` files with
 * fresh ids and one `history` entry sharing one change id, all or nothing, and
 * returns the commit for the agent to run (ADR agent-runs-the-commit).
 */
export const coverOperation = defineOperation({
  name: "cover",
  input: CoverInput,
  output: CoverOutput,
  actor: ["agent"],
  writes: [`**/${TESTS_DIR}/**/TC-*.md`],
  spec: "specs/cover.md",
  subject: "feature",
  async run(input, context) {
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
        origin: "agent",
        ...fields,
        history: [
          {
            at,
            by: input.requestedBy,
            via: "cli:cover",
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
      commit: {
        author: AGENT_AUTHOR,
        message: commitMessage(
          `cover(${input.feature}): propose ${count} ${count === 1 ? "case" : "cases"}`,
          { requestedBy: input.requestedBy, inbox: input.inbox, agent: input.agent, change },
        ),
      },
      next: [
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

/** Titles compare without case or repeated spaces: "Sign in" = "sign  in". */
function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The case file: frontmatter with casefile's keys first and the rest in schema
 * order, short lists inline, timestamps quoted (as in `casefile spec cover`).
 */
function caseText(file: TestCaseFile, notes: string | undefined): string {
  const order = [...OWN_KEYS, ...Object.keys(TestCaseFile.shape)];
  const record = file as Record<string, unknown>;
  const ordered = Object.fromEntries(
    [...new Set(order)].filter((key) => record[key] !== undefined).map((key) => [key, record[key]]),
  );
  const doc = new Document(ordered);
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (FLOW_LISTS.has(key) && isSeq(pair.value)) pair.value.flow = true;
      if (key === "at" && isScalar(pair.value)) pair.value.type = Scalar.QUOTE_DOUBLE;
    },
  });
  const frontmatter = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  const body = notes?.trim() ? `\n${notes.trim()}\n` : "";
  return `---\n${frontmatter}---\n${body}`;
}
