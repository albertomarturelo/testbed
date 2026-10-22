import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { fail, ok } from "../errors.js";
import { AGENT_AUTHOR, runCommitMessage } from "../git/trailers.js";
import { boundNote } from "../ingest/note.js";
import { TESTS_DIR } from "../load/paths.js";
import { loadWorkspace } from "../load/workspace.js";
import { FileSafeId, RunEvent, RunStatus } from "../schema/index.js";
import { WriteCommit, WriterInput } from "./case-file.js";
import { CaseRef, findCase } from "./cases.js";
import { defineOperation } from "./operation.js";

const RunInput = z.strictObject({
  /** The case, looked up like `casefile resolve`. */
  ref: CaseRef,
  /** What the executor saw; `not_run` is a planned case, not a result. */
  status: RunStatus.exclude(["not_run"]),
  /** Why it ended so; cut to `NOTE_MAX` (ADR run-event-note). */
  note: z.string().min(1).optional(),
  env: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
  release: z.string().min(1).optional(),
  /** The run file `.runs/<run>.jsonl`; default `manual-<UTC date>`. */
  run: FileSafeId.optional(),
  identity: WriterInput.identity,
  agent: WriterInput.agent,
  project: z.string().min(1).optional().meta({ host: "project" }),
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
  writes: [`**/${TESTS_DIR}/.runs/*.jsonl`],
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

    const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const run = input.run ?? `manual-${at.slice(0, 10)}`;
    const optional = {
      env: input.env,
      build: input.build,
      release: input.release,
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
      return ok({
        ref,
        run,
        path,
        appended: false,
        event,
        next: [
          `Nothing new: this result is already the last of ${ref} in ${path} (a retry? commit that file if the first call's commit failed)`,
        ],
      });
    }
    const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await context.writeText(path, `${existing}${separator}${JSON.stringify(event)}\n`);

    const message = runCommitMessage(
      `run(${loaded.file.feature}): record ${loaded.file.id} as ${input.status}`,
      { run, executor },
    );
    return ok({
      ref,
      run,
      path,
      appended: true,
      event,
      commit: agent ? { author: AGENT_AUTHOR, message } : { message },
      next: [
        agent
          ? "Commit the run file with commit.author and commit.message taken from --json output, staging only it (`git commit -F <message> -- <path>`)"
          : "Commit the run file with commit.message taken from --json output, as yourself, staging only it (`git commit -F <message> -- <path>`)",
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
  const { at: _, ...previous } = last as Record<string, unknown>;
  const { at: __, ...current } = event;
  return isDeepStrictEqual(previous, current);
}
