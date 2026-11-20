import { randomUUID } from "node:crypto";
import { isMap, isScalar, isSeq, parseDocument, YAMLSeq } from "yaml";
import { z } from "zod";
import { fail, ok } from "../errors.js";
import { commitAdvice } from "../git/advice.js";
import { CommitInput, commitSubject } from "../git/subject.js";
import { MILESTONES_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { parseQuery } from "../query/parse.js";
import {
  CalendarDate,
  FileSafeId,
  Milestone,
  type MilestoneEditableField,
} from "../schema/index.js";
import { WriteCommit, WriterInput, writeCommit, writtenBy } from "./case-file.js";
import { requireProject } from "./cases.js";
import { findMilestone } from "./milestones.js";
import { defineOperation } from "./operation.js";

type Field = z.infer<typeof MilestoneEditableField>;

const MilestoneEditInput = z.strictObject({
  /** The open milestone to change: `context/milestones/<slug>.yaml`. */
  slug: FileSafeId,
  title: Milestone.shape.title.optional(),
  /** A date `YYYY-MM-DD`, or `""` to remove it. */
  due: z.string().optional(),
  /** The version or Git tag it certifies, or `""` to remove it. */
  release: z.string().optional(),
  /** The cases it covers, as a query; never empty (write `state = active` for the default). */
  scope: z.string().min(1).optional(),
  ...WriterInput,
  ...CommitInput,
  project: z.string().min(1).optional().meta({ host: "project" }),
});

const MilestoneEditOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  path: z.string(),
  /** The fields this call changed, in file order; `[]` when nothing differed. */
  changed: z.array(z.string()),
  /** `null` when nothing was written. */
  change: z.string().nullable(),
  /** `null` when nothing was written: there is nothing to commit. */
  commit: WriteCommit.nullable(),
  next: z.array(z.string()),
});

/** The file's top-level keys in the order `open` and `close` write them. */
const KEY_ORDER = Object.keys(Milestone.shape);

/**
 * `casefile milestone edit <slug> [--title] [--due] [--release] [--scope]`
 * (ADR milestones-group-executions §2, #210): changes the given fields of an
 * open milestone, appends who changed them to `edited`, and returns the
 * commit. A closed milestone is frozen evidence and is refused.
 */
export const milestoneEditOperation = defineOperation({
  name: "milestone-edit",
  input: MilestoneEditInput,
  output: MilestoneEditOutput,
  actor: ["agent", "human"],
  writes: [`**/${MILESTONES_DIR}/*.yaml`],
  spec: "specs/milestone.md",
  subject: "slug",
  async run(input, context) {
    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const agentTrailer = workspace.config.commit?.agent_trailer !== false;
    const writer = writtenBy("milestone", context.actor, input, agentTrailer);
    if (!writer.ok) return writer;
    const { by, agent, asAgent } = writer.value;
    const selected = requireProject(workspace, input.project);
    if (!selected.ok) return selected;
    const project = selected.value;
    const milestone = findMilestone(project, input.slug);
    if (!milestone.ok) return milestone;
    const { path, file } = milestone.value;
    if (file.state === "closed") {
      return fail({
        code: "milestone.closed",
        field: "slug",
        path,
        message: `milestone '${input.slug}' is closed: its evidence is frozen; a correction is a new milestone`,
      });
    }

    const given = {
      title: input.title,
      due: input.due,
      release: input.release,
      scope: input.scope,
    };
    if (Object.values(given).every((value) => value === undefined)) {
      return fail({
        code: "milestone.edit_empty",
        message: "give at least one of --title, --due, --release, --scope",
      });
    }
    if (input.due !== undefined && input.due !== "" && !CalendarDate.safeParse(input.due).success) {
      return fail({
        code: "operation.invalid_input",
        field: "due",
        message: `due: '${input.due}' is not a date YYYY-MM-DD; "" removes it`,
      });
    }
    if (input.scope !== undefined) {
      const parsed = parseQuery(input.scope);
      if (!parsed.ok) {
        return fail(
          ...parsed.errors.map((error) => ({
            ...error,
            code: "milestone.invalid_scope",
            field: "scope",
            message: `scope: ${error.message}`,
          })),
        );
      }
    }

    // `""` removes an optional field; a field equal to the file's is no change.
    const wanted = Object.fromEntries(
      Object.entries(given)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, value === "" ? undefined : value]),
    ) as Partial<Record<Field, string | undefined>>;
    const changed = (Object.keys(wanted) as Field[])
      .filter((key) => wanted[key] !== file[key])
      .sort((a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b));
    if (changed.length === 0) {
      return ok({
        project: project.name,
        slug: input.slug,
        path,
        changed: [],
        change: null,
        commit: null,
        next: [
          `Nothing to change: milestone '${input.slug}' already has those values; nothing was written`,
        ],
      });
    }
    const subject = commitSubject(
      workspace.config.commit,
      { type: "test", scope: project.name, summary: `edit milestone ${input.slug}` },
      input,
    );
    if (!subject.ok) return subject;

    // Edit the stored document, so comments the human wrote survive (as `close` does).
    const change = randomUUID();
    const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const text = (await context.readText(path)) ?? "";
    const document = parseDocument(text);
    for (const key of changed) {
      const value = wanted[key];
      if (value === undefined) document.delete(key);
      else document.set(key, value);
    }
    const entry = document.createNode({ at, by, change, fields: changed });
    const edited = document.get("edited");
    if (isSeq(edited)) edited.add(entry);
    else {
      const list = new YAMLSeq();
      list.add(entry);
      document.set("edited", list);
    }
    if (isMap(document.contents)) {
      const rank = (pair: { key: unknown }) => {
        const index = KEY_ORDER.indexOf(String(isScalar(pair.key) ? pair.key.value : pair.key));
        return index === -1 ? KEY_ORDER.length : index;
      };
      document.contents.items.sort((a, b) => rank(a) - rank(b));
    }
    Milestone.parse(document.toJS());
    await context.writeText(path, document.toString({ lineWidth: 0 }));

    const commit = writeCommit(
      subject.value,
      { requestedBy: by, inbox: input.inbox, agent, change },
      [path],
      asAgent,
    );
    return ok({
      project: project.name,
      slug: input.slug,
      path,
      changed,
      change,
      commit,
      next: [
        commitAdvice("the file", commit),
        `See what it covers now: casefile milestone report ${input.slug}`,
      ],
    });
  },
});
