import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { type CasefileError, fail, ok } from "../errors.js";
import { TESTS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { commonsChain, resolveCase, workspaceLayer } from "../resolve/resolve.js";
import {
  CaseState,
  ChangeId,
  type HistoryEntry,
  HistoryEventKind,
  StoredAutomationStatus,
  TestCaseFile,
} from "../schema/index.js";
import {
  bodyBytes,
  CaseTitle,
  caseFrontmatter,
  normalizeTitle,
  notesBody,
  WriteCommit,
  WriterInput,
  writeCommit,
  writtenBy,
} from "./case-file.js";
import { CaseRef, findCase } from "./cases.js";
import { extensionLayers, loadExtensions } from "./extensions.js";
import { defineOperation } from "./operation.js";

const field = TestCaseFile.shape;

/** A list or map field `null` removes, so the case inherits it from its commons again. */
function clearable<T extends z.ZodType>(schema: z.ZodOptional<T>) {
  return schema.unwrap().nullable().optional();
}

/** Fields casefile owns: named in `set`, they are `review.not_editable`, not unknown keys. */
const NOT_EDITABLE = [
  "id",
  "feature",
  "state",
  "origin",
  "history",
  "mirror",
  "duplicates_checked_against",
] as const;

/**
 * What `set` may change (`casefile spec review`). Each field replaces the stored
 * one; `automation` merges per key. `automation.status` is never `automated` or
 * `flaky`: those are derived from runs (ADR write-ownership).
 */
const ReviewSet = z.strictObject({
  title: CaseTitle.optional(),
  acceptance_ref: clearable(field.acceptance_ref),
  surfaces: clearable(field.surfaces),
  layer: clearable(field.layer),
  automation: z
    .strictObject({
      eligible: z.boolean().nullable().optional(),
      status: StoredAutomationStatus.nullable().optional(),
      ref: z.string().min(1).nullable().optional(),
    })
    .optional(),
  priority: clearable(field.priority),
  labels: clearable(field.labels),
  preconditions: clearable(field.preconditions),
  data: clearable(field.data),
  steps: field.steps.optional(),
  work_items: clearable(field.work_items),
  /** Markdown that replaces the body of the file; absent, the body is kept byte for byte. */
  notes: z.string().nullable().optional(),
  ...Object.fromEntries(NOT_EDITABLE.map((key) => [key, z.unknown().optional()])),
});
type ReviewSet = z.infer<typeof ReviewSet>;

/** The fields `set` edits, in schema order; `notes` (the body) comes last. */
const EDITABLE = Object.keys(field).filter(
  (key) => Object.hasOwn(ReviewSet.shape, key) && !NOT_EDITABLE.includes(key as never),
);

const ReviewInput = z
  .strictObject({
    /** The case, looked up like `casefile resolve`. */
    ref: CaseRef,
    set: ReviewSet.optional(),
    /** The state to move to (`casefile spec review`, Transitions). */
    to: CaseState.optional(),
    /** Why: the `note` of the `history` entries. */
    note: z.string().min(1).optional(),
    /** The `change` of the last `history` entry the caller read. */
    base: ChangeId.optional(),
    ...WriterInput,
    project: z.string().min(1).optional().meta({ host: "project" }),
  })
  .refine((input) => input.set !== undefined || input.to !== undefined, {
    message: "give set, to or both",
    path: ["set"],
  });

const ReviewOutput = z.strictObject({
  ref: z.string(),
  path: z.string(),
  change: z.string(),
  state: CaseState,
  changed: z.array(z.string()),
  events: z.array(HistoryEventKind),
  commit: WriteCommit,
  next: z.array(z.string()),
});

type Transition = { event: HistoryEntry["event"]; verb: string };

/** `from>to` → the `history` event and the commit verb (`casefile spec review`). */
const TRANSITIONS: Record<string, Transition> = {
  "draft>in_review": { event: "review_requested", verb: "request review of" },
  "draft>active": { event: "reviewed", verb: "approve" },
  "in_review>active": { event: "reviewed", verb: "approve" },
  "in_review>draft": { event: "state_changed", verb: "send back" },
  "draft>retired": { event: "retired", verb: "reject" },
  "in_review>retired": { event: "retired", verb: "reject" },
  "active>retired": { event: "retired", verb: "retire" },
  "retired>draft": { event: "state_changed", verb: "reopen" },
};

/**
 * `casefile review <ref> [--set '<json>'] [--to <state>]`: changes one case's
 * fields, its state, or both, for the agent or the QA (ADR authoring-loop-first,
 * human-writes-through-operations). Rewrites only the frontmatter, appends the
 * `history` entries with one change id, all or nothing, and returns the commit
 * (ADR agent-runs-the-commit).
 */
export const reviewOperation = defineOperation({
  name: "review",
  input: ReviewInput,
  output: ReviewOutput,
  actor: ["agent", "human"],
  writes: [`**/${TESTS_DIR}/**/TC-*.md`],
  spec: "specs/review.md",
  subject: "ref",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const found = findCase(workspace, input.ref, input.project);
    if (!found.ok) return found;
    const { project, case: loaded } = found.value;
    const stored = loaded.file;

    const writer = writtenBy("review", context.actor, input);
    if (!writer.ok) return writer;
    const { by, agent } = writer.value;

    const last = stored.history.at(-1);
    if (input.base !== undefined && input.base !== last?.change) {
      return fail({
        code: "review.stale",
        field: "base",
        path: loaded.path,
        message: `${stored.id} changed after you read it (its last change is ${last?.change}): read it again with casefile resolve and redo the change on it`,
      });
    }

    const set: ReviewSet = input.set ?? {};
    const errors: CasefileError[] = [];
    for (const key of NOT_EDITABLE.filter((k) => Object.hasOwn(set, k))) {
      errors.push({
        code: "review.not_editable",
        field: `set.${key}`,
        message:
          key === "state"
            ? "the state changes only through --to"
            : `${key} is casefile's to write, not a review's`,
      });
    }

    const edited: Record<string, unknown> = { ...stored };
    const changed: string[] = [];
    for (const key of EDITABLE.filter((k) => Object.hasOwn(set, k))) {
      const before = (stored as Record<string, unknown>)[key];
      const after =
        key === "automation"
          ? mergeAutomation(stored.automation, set.automation ?? {})
          : ((set as Record<string, unknown>)[key] ?? undefined);
      if (isDeepStrictEqual(after, before)) continue;
      changed.push(key);
      if (after === undefined) delete edited[key];
      else edited[key] = after;
    }
    const kept = bodyBytes((await context.readText(loaded.path)) ?? "");
    let body = kept;
    if (Object.hasOwn(set, "notes") && notesBody(set.notes) !== kept) {
      changed.push("notes");
      body = notesBody(set.notes);
    }

    let transition: Transition | undefined;
    if (input.to !== undefined) {
      transition = TRANSITIONS[`${stored.state}>${input.to}`];
      if (transition === undefined) {
        const allowed = Object.keys(TRANSITIONS)
          .filter((pair) => pair.startsWith(`${stored.state}>`))
          .map((pair) => pair.split(">")[1]);
        errors.push({
          code: "review.invalid_transition",
          field: "to",
          message: `${stored.id} is ${stored.state}: it can move to ${allowed.join(" or ")}, not ${input.to}`,
        });
      }
    } else if (changed.length === 0 && errors.length === 0) {
      errors.push({
        code: "review.no_change",
        field: "set",
        message: `every value in set equals what ${stored.id} already has (a retry? commit the file of the first call)`,
      });
    }

    if (changed.includes("title")) {
      const title = normalizeTitle(edited.title as string);
      const clash = project.cases.find(
        (c) =>
          c !== loaded &&
          posix.dirname(c.path) === posix.dirname(loaded.path) &&
          normalizeTitle(c.file.title) === title,
      );
      if (clash !== undefined) {
        errors.push({
          code: "review.duplicate_title",
          field: "set.title",
          message: `'${edited.title}' is already the title of ${clash.file.id} in '${stored.feature}'`,
        });
      }
    }
    const declared = project.properties?.properties ?? {};
    for (const label of Object.keys(set.labels ?? {})) {
      if (Object.hasOwn(declared, label)) continue;
      errors.push({
        code: "label.undeclared",
        field: `set.labels.${label}`,
        message: `label '${label}' is not declared in ${posix.join(project.path, TESTS_DIR, "_properties.yaml")}`,
      });
    }

    const change = randomUUID();
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const entry = (event: HistoryEntry["event"]): HistoryEntry => ({
      at,
      by,
      via: input.via,
      change,
      ...(input.inbox === undefined ? {} : { inbox: input.inbox }),
      event,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    const events = [
      ...(changed.length > 0 ? (["updated"] as const) : []),
      ...(transition === undefined ? [] : [transition.event]),
    ];
    const file = TestCaseFile.parse({
      ...edited,
      state: transition === undefined ? stored.state : input.to,
      history: [...stored.history, ...events.map(entry)],
    });

    const { extensions } = await loadExtensions(context.root, workspace.config.extensions ?? []);
    const resolved = resolveCase(
      { path: loaded.path, file, body: "" },
      {
        project: project.name,
        layers: [
          ...extensionLayers(extensions),
          ...workspaceLayer(workspace.config),
          ...commonsChain(project.commons, project.path, loaded.path),
        ],
        runs: [],
        commitFor: () => null,
      },
    );
    if (!resolved.ok) {
      errors.push(
        ...resolved.errors.map(({ path: _, ...error }) => ({
          ...error,
          field: `set.${error.field ?? ""}`,
          message: `${error.message}: after this change it is set nowhere; give it a value, or set it in the commons`,
        })),
      );
    }
    if (errors.length > 0) return fail(...errors);

    await context.writeText(loaded.path, caseFrontmatter(file) + body);
    const verbs = [
      ...(changed.length > 0 ? ["edit"] : []),
      ...(transition ? [transition.verb] : []),
    ];
    return ok({
      ref: `${project.name}/${stored.id}`,
      path: loaded.path,
      change,
      state: file.state,
      changed,
      events,
      commit: writeCommit(`review(${stored.feature}): ${verbs.join(" and ")} ${stored.id}`, {
        requestedBy: by,
        inbox: input.inbox,
        agent,
        change,
      }),
      next: [
        agent === undefined
          ? "Commit the file with commit.message taken from --json output, as yourself, staging only it (`git commit -F <message> -- <path>`)"
          : "Commit the file with commit.author and commit.message taken from --json output, staging only it (`git commit -F <message> -- <path>`)",
      ],
    });
  },
});

type Automation = NonNullable<TestCaseFile["automation"]>;

/** `automation` merged per key, `null` removing one; keys in schema order; empty → removed. */
function mergeAutomation(
  stored: Automation | undefined,
  patch: NonNullable<ReviewSet["automation"]>,
): Automation | undefined {
  const merged: Record<string, unknown> = {};
  for (const key of ["eligible", "status", "ref"] as const) {
    const value = Object.hasOwn(patch, key) ? patch[key] : stored?.[key];
    if (value !== null && value !== undefined) merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? (merged as Automation) : undefined;
}
