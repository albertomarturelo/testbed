import { join, posix, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import { commitAdvice } from "../git/advice.js";
import { CommitInput, commitSubject } from "../git/subject.js";
import { AGENT_AUTHOR, runCommitMessage } from "../git/trailers.js";
import { boundNote } from "../ingest/note.js";
import { TESTS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import {
  type Evidence,
  type EvidenceConfig,
  EvidenceLabel,
  FileSafeId,
  RunEvent,
  RunStatus,
  withMilestone,
} from "../schema/index.js";
import { WriteCommit, WriterInput } from "./case-file.js";
import { CaseRef, findCase } from "./cases.js";
import {
  type EvidenceEntry,
  evidenceEntryProblems,
  evidenceKind,
  evidenceLimits,
  extensionOf,
  sha256Hex,
  storedEvidencePath,
} from "./evidence.js";
import { MilestoneInput, namedMilestone, RELEASE_DEPRECATED } from "./milestones.js";
import { defineOperation, type OperationContext } from "./operation.js";

/** One labelled file or link, for the viewer and agents (ADR run-evidence-files §5). */
const Attachment = z.union([
  z.strictObject({ file: z.string().min(1), label: EvidenceLabel.optional() }),
  z.strictObject({ url: z.string().min(1), label: EvidenceLabel.optional() }),
]);

const RunInput = z.strictObject({
  /** The case, looked up like `casefile resolve`. */
  ref: CaseRef,
  /** What the executor saw; `not_run` is a planned case, not a result. */
  status: RunStatus.exclude(["not_run"]),
  /** Why it ended so; cut to `NOTE_MAX` (ADR run-event-note). */
  note: z.string().min(1).optional(),
  /** Files to attach, copied into `.runs/<run>/<case>/` (ADR run-evidence-files). */
  evidence: z.array(z.string().min(1)).optional(),
  /** Links to attach, kept as URLs and never fetched. */
  link: z.array(z.string().min(1)).optional(),
  /** Files and links with a label: `[{ file, label? } | { url, label? }]`, after `evidence` and `link`. */
  attach: z.array(Attachment).optional(),
  env: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
  ...MilestoneInput,
  /** The run file `.runs/<run>.jsonl`; default `manual-<UTC date>`. */
  run: FileSafeId.optional(),
  identity: WriterInput.identity,
  author: WriterInput.author,
  agent: WriterInput.agent,
  ...CommitInput,
  project: z.string().min(1).optional().meta({ host: "project" }),
  /** Where relative `file` paths resolve: the directory the user invoked the host from. */
  cwd: z.string().min(1).optional().meta({ host: "cwd" }),
});

const RunOutput = z.strictObject({
  ref: z.string(),
  run: z.string(),
  path: z.string(),
  /** `false`: the same result was already the case's last in the run file. */
  appended: z.boolean(),
  event: RunEvent,
  commit: WriteCommit.optional(),
  next: z.array(z.string()),
});

/**
 * `casefile run <ref> --status <status>`: a human or an agent records the result
 * of a case it executed (ADR human-writes-through-operations). casefile runs
 * nothing: it appends one run event and returns the commit of the run file
 * (ADR ci-commits-run-files §2). The event never carries `automation_ref`, so
 * only ingested reports make a case `automated` (ADR write-ownership).
 */
export const runOperation = defineOperation({
  name: "run",
  input: RunInput,
  output: RunOutput,
  actor: ["human", "agent"],
  writes: [`**/${TESTS_DIR}/.runs/*.jsonl`, `**/${TESTS_DIR}/.runs/*/*/*`],
  spec: "specs/run.md",
  subject: "ref",
  async run(input, context) {
    const agent = context.actor === "agent";
    if (agent && input.agent === undefined) {
      return fail({
        code: "run.agent_required",
        field: "agent",
        message: "an agent names itself with --agent <name>: the executor is agent:<name>",
      });
    }
    if (!agent && input.agent !== undefined) {
      return fail({
        code: "run.agent_not_allowed",
        field: "agent",
        message: "--agent is for agents: a human's executor is human:<git config user.email>",
      });
    }
    if (!agent && input.identity === undefined) {
      return fail({
        code: "identity.missing",
        field: "identity",
        message:
          "no `git config user.email` in the workspace: set it, so the result names who ran it",
      });
    }
    const executor = agent ? `agent:${input.agent}` : `human:${input.identity}`;

    const workspace = await loadWorkspace(context.root);
    if (workspace.config === null) return fail(...workspace.errors);
    const found = findCase(workspace, input.ref, input.project);
    if (!found.ok) return found;
    const { project, case: loaded } = found.value;
    const milestone = namedMilestone(project, input);
    if (!milestone.ok) return milestone;

    const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const run = input.run ?? `manual-${at.slice(0, 10)}`;
    const entries: EvidenceEntry[] = [
      ...(input.evidence ?? []).map((file, i) => ({ field: `evidence.${i}`, file })),
      ...(input.link ?? []).map((url, i) => ({ field: `link.${i}`, url })),
      ...(input.attach ?? []).map((entry, i) => ({ field: `attach.${i}`, ...entry })),
    ];
    const attached = await prepareEvidence(entries, context, {
      from: input.cwd ?? context.root,
      config: workspace.config.evidence,
      dir: { project: project.path, run, caseId: loaded.file.id },
    });
    if (!attached.ok) return attached;
    const optional = {
      env: input.env,
      build: input.build,
      milestone: milestone.value,
      evidence: entries.length === 0 ? undefined : attached.value.evidence,
      note: boundNote(input.note),
    };
    // Absent fields are left out, not `undefined`: the event equals its line in the file.
    const event = RunEvent.parse({
      run_id: run,
      case_id: loaded.file.id,
      status: input.status,
      executor,
      at,
      ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    });

    const path = posix.join(project.path, TESTS_DIR, ".runs", `${run}.jsonl`);
    const existing = (await context.readText(path)) ?? "";
    const ref = `${project.name}/${loaded.file.id}`;
    if (isRetry(existing, event)) {
      // The first call's commit may have failed: name every file it would carry.
      const stored: string[] = [];
      for (const file of attached.value.files) {
        if ((await context.sizeOf(join(context.root, file))) !== null) stored.push(file);
      }
      const files = [path, ...stored].join(" ");
      return ok({
        ref,
        run,
        path,
        appended: false,
        event,
        next: [
          stored.length === 0
            ? `Nothing new: this result is already the last of ${ref} in ${path} (a retry? commit that file if the first call's commit failed)`
            : `Nothing new: this result is already the last of ${ref} in ${path} (a retry? if the first call's commit failed, commit the run file and its evidence files: ${files})`,
        ],
      });
    }
    const subject = commitSubject(
      workspace.config.commit,
      {
        type: "test",
        scope: loaded.file.feature,
        summary: `record ${loaded.file.id} as ${input.status}`,
      },
      input,
    );
    if (!subject.ok) return subject;
    // Evidence first: the line never names a file that is not there.
    for (const file of attached.value.writes) {
      if (await context.writeBytes(file.path, file.bytes)) continue;
      // Created since it was checked (another call at the same time): fine
      // when it holds the same content, never overwritten otherwise.
      const absolute = join(context.root, file.path);
      const size = await context.sizeOf(absolute);
      const sha = sha256Hex(file.bytes);
      if (!(await sameContent(context, absolute, size ?? 0, file.bytes.length, sha))) {
        return fail(conflict(file.path, undefined));
      }
    }
    const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await context.writeText(path, `${existing}${separator}${JSON.stringify(event)}\n`);

    const message = runCommitMessage(subject.value, { run, executor });
    const files = [path, ...attached.value.files];
    const what = files.length > 1 ? "the run file and its evidence files" : "the run file";
    // A human commits as the resolved identity when it overrides git's (ADR identity-override §4).
    const author = agent ? AGENT_AUTHOR : input.author;
    const commit = author === undefined ? { message, files } : { author, message, files };
    return ok({
      ref,
      run,
      path,
      appended: true,
      event,
      commit,
      next: [
        commitAdvice(what, commit),
        ...(input.release === undefined ? [] : [RELEASE_DEPRECATED]),
      ],
    });
  },
});

/**
 * Whether the case's last event in the run file is this one apart from `at`: a
 * retried call. Only the last counts, so a case executed again (passed, failed,
 * passed) always records its new result (`casefile spec run`, Idempotency).
 */
function isRetry(existing: string, event: RunEvent): boolean {
  let last: unknown;
  for (const line of existing.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if ((value as { case_id?: unknown } | null)?.case_id === event.case_id) last = value;
    } catch {
      // `casefile validate` reports it; it is no case's event.
    }
  }
  if (last === null || typeof last !== "object") return false;
  const { at: _, ...previous } = withMilestone(last as Record<string, unknown>);
  const { at: __, ...current } = event;
  return isDeepStrictEqual(previous, current);
}

type PreparedEvidence = {
  /** The event's `evidence`, in input order. */
  evidence: Evidence[];
  /** Files to write: each stored path once, only when it is not there yet. */
  writes: { path: string; bytes: Uint8Array }[];
  /** Every stored path the event names, once: the commit carries them. */
  files: string[];
};

/**
 * Checks every entry against the workspace's limits, reads and hashes the
 * files, and plans where they go (ADR run-evidence-files §2–4). Writes nothing:
 * any problem fails the call before the first write.
 */
async function prepareEvidence(
  entries: readonly EvidenceEntry[],
  context: OperationContext,
  at: {
    from: string;
    config: EvidenceConfig | undefined;
    dir: { project: string; run: string; caseId: string };
  },
): Promise<Result<PreparedEvidence>> {
  const prepared: PreparedEvidence = { evidence: [], writes: [], files: [] };
  if (entries.length === 0) return ok(prepared);
  const limits = evidenceLimits(at.config);
  const problems = evidenceEntryProblems(entries, limits.extensions);
  if (problems.length > 0) return fail(...problems);

  const errors: CasefileError[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const label = entry.label === undefined ? {} : { label: entry.label };
    if ("url" in entry) {
      prepared.evidence.push({ kind: "link", ref: entry.url, ...label });
      continue;
    }
    const source = resolve(at.from, entry.file);
    // The size first: a file over the limit is never read (ADR run-evidence-files §4).
    const size = await context.sizeOf(source);
    if (size === null || size === "not_a_file") {
      errors.push({
        code: "evidence.not_found",
        field: entry.field,
        message:
          size === null
            ? `${entry.file}: no such file (looked for ${source})`
            : `${entry.file}: ${source} is not a regular file (a directory, device or socket)`,
      });
      continue;
    }
    if (size > limits.maxBytes) {
      errors.push({
        code: "evidence.too_large",
        field: entry.field,
        message: `${entry.file} is ${megabytes(size)} MB; evidence files are at most ${megabytes(limits.maxBytes)} MB (evidence.max_file_mb in casefile.yaml); attach a long video as a link`,
      });
      continue;
    }
    const bytes = await context.readBytes(source);
    if (bytes === null) {
      errors.push({
        code: "evidence.not_found",
        field: entry.field,
        message: `${entry.file}: no such file (looked for ${source})`,
      });
      continue;
    }
    const sha256 = sha256Hex(bytes);
    const { project, run, caseId } = at.dir;
    const ref = storedEvidencePath(project, run, caseId, sha256, source);
    prepared.evidence.push({ kind: evidenceKind(extensionOf(source)), ref, sha256, ...label });
    if (seen.has(ref)) continue;
    seen.add(ref);
    prepared.files.push(ref);
    const stored = join(context.root, ref);
    const storedSize = await context.sizeOf(stored);
    if (storedSize === null) prepared.writes.push({ path: ref, bytes });
    else if (!(await sameContent(context, stored, storedSize, bytes.length, sha256))) {
      errors.push(conflict(ref, entry.field));
    }
  }
  return errors.length > 0 ? fail(...errors) : ok(prepared);
}

/** Whether the stored file at `absolute` is a regular file holding these bytes. */
async function sameContent(
  context: OperationContext,
  absolute: string,
  size: number | "not_a_file",
  expectedSize: number,
  sha256: string,
): Promise<boolean> {
  if (size !== expectedSize) return false;
  const bytes = await context.readBytes(absolute);
  return bytes !== null && sha256Hex(bytes) === sha256;
}

/** A file is never overwritten (ADR run-evidence-files §2). */
function conflict(ref: string, field: string | undefined): CasefileError {
  return {
    code: "evidence.conflict",
    ...(field === undefined ? {} : { field }),
    path: ref,
    message: `${ref} already exists with other content; it is never overwritten (casefile validate reports it as evidence.changed)`,
  };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}
