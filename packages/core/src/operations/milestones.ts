import { posix } from "node:path";
import { z } from "zod";
import { fail, ok, type Result } from "../errors.js";
import { MILESTONES_DIR, POLICY_FILE } from "../load/paths.js";
import type { LoadedProject } from "../load/workspace.js";
import {
  type EvidenceDocument,
  evidenceDocument,
  type MilestoneEvidence,
  milestoneEvidence,
  parseEvidence,
  redGates,
  renderEvidence,
} from "../milestones/evidence.js";
import type { ResolvedCase } from "../resolve/resolve.js";
import type { Milestone } from "../schema/index.js";

/** The inputs an execution names its milestone with (ADR milestones-group-executions §3, §8). */
export const MilestoneInput = {
  /** An open milestone of the project: `context/milestones/<slug>.yaml`. */
  milestone: z.string().min(1).optional(),
  /** Deprecated until `1.0`: the name `milestone` had before `0.2.0`. */
  release: z.string().min(1).optional(),
};

/** What `next` says when the old `--release` was used. */
export const RELEASE_DEPRECATED =
  "--release is deprecated: name the milestone with --milestone (ADR milestones-group-executions)";

/**
 * The milestone an execution belongs to, `undefined` when it names none. It
 * must be declared and open: an unknown or closed one is refused before
 * anything is written, so a typo cannot split a milestone and a closed
 * milestone's evidence cannot change.
 */
export function namedMilestone(
  project: LoadedProject,
  input: { milestone?: string; release?: string },
): Result<string | undefined> {
  if (input.milestone !== undefined && input.release !== undefined) {
    return fail({
      code: "operation.invalid_input",
      field: "release",
      message: "give --milestone only: --release is its old name",
    });
  }
  const slug = input.milestone ?? input.release;
  if (slug === undefined) return ok(undefined);
  const field = input.milestone === undefined ? "release" : "milestone";
  const declared = project.milestones.get(slug);
  if (declared === undefined) {
    const known = [...project.milestones.entries()]
      .filter(([, m]) => m.file.state === "open")
      .map(([name]) => name);
    return fail({
      code: "milestone.unknown",
      field,
      message: `${project.name} has no milestone '${slug}'${
        known.length === 0 ? "" : ` (open: ${known.join(", ")})`
      }: open it first with casefile milestone open ${slug} --title <title>`,
    });
  }
  if (declared.file.state === "closed") {
    return fail({
      code: "milestone.closed",
      field,
      path: declared.path,
      message: `milestone '${slug}' is closed: its evidence is frozen; record in an open milestone`,
    });
  }
  return ok(slug);
}

/** A declared milestone of the project, open or closed; `milestone.unknown` otherwise. */
export function findMilestone(
  project: LoadedProject,
  slug: string,
): Result<{ path: string; file: Milestone }> {
  const declared = project.milestones.get(slug);
  if (declared !== undefined) return ok(declared);
  const known = [...project.milestones.keys()];
  return fail({
    code: "milestone.unknown",
    field: "slug",
    message: `${project.name} has no milestone '${slug}'${
      known.length === 0 ? "" : ` (declared: ${known.join(", ")})`
    }`,
  });
}

/** `context/milestones/<slug>/evidence.md`: what `close` freezes (ADR milestones-group-executions §4). */
export function evidencePath(project: LoadedProject, slug: string): string {
  return posix.join(project.path, MILESTONES_DIR, slug, "evidence.md");
}

/** Evidence of one milestone from the project's loaded cases, runs and policy. */
export function projectEvidence(
  project: LoadedProject,
  cases: readonly ResolvedCase[],
  slug: string,
  milestone: { path: string; file: Milestone },
  close: { closed: { at: string; by: string } | null; note?: string; today: string },
): Result<MilestoneEvidence> {
  return milestoneEvidence({
    project: project.name,
    slug,
    milestone: milestone.file,
    milestonePath: milestone.path,
    cases: cases.filter((c) => c.project === project.name),
    runs: project.runs,
    policy:
      project.policy === null
        ? null
        : { policy: project.policy, path: posix.join(project.path, POLICY_FILE) },
    ...close,
  });
}

const Stamp = z.strictObject({ at: z.string(), by: z.string() });

/** Totals over a milestone's in-scope cases (`EvidenceTotals`). */
export const EvidenceTotalsOutput = z.strictObject({
  in_scope: z.number().int(),
  executed: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  blocked: z.number().int(),
  not_run: z.number().int(),
});

/** `EvidenceDocument` as operations return it: what the viewer shows and prints. */
export const EvidenceDocumentOutput = z.strictObject({
  project: z.string(),
  slug: z.string(),
  title: z.string(),
  release: z.string().nullable(),
  due: z.string().nullable(),
  scope: z.string(),
  build: z.string().nullable(),
  opened: Stamp.nullable(),
  closed: Stamp.nullable(),
  totals: EvidenceTotalsOutput,
  /** `null` when the project has no release policy. */
  gates: z
    .array(
      z.strictObject({
        name: z.string(),
        verdict: z.string(),
        cases: z.number().int(),
        reasons: z.string().nullable(),
      }),
    )
    .nullable(),
  cases: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      priority: z.string(),
      result: z.enum(["passed", "failed", "blocked"]).nullable(),
      executor: z.string().nullable(),
      at: z.string().nullable(),
      build: z.string().nullable(),
      note: z.string().nullable(),
      evidence: z.array(z.string()),
    }),
  ),
  note: z.string().nullable(),
});

/** What a page shows of one milestone: the same numbers as its evidence file. */
export type MilestoneDocument = {
  state: "open" | "closed";
  /** `null` only when closed and the frozen file is gone or no longer has core's shape. */
  document: EvidenceDocument | null;
  /** Gates red in `document`: now while open, at the close once closed. */
  red: string[];
  /** The Markdown: generated now while open, the frozen file once closed (`null`: gone). */
  markdown: string | null;
};

/**
 * One milestone as a document: generated from the files now while open, read
 * back from the frozen file once closed, so a page never shows other numbers
 * than the evidence `close` committed.
 */
export async function milestoneDocument(
  project: LoadedProject,
  cases: readonly ResolvedCase[],
  slug: string,
  milestone: { path: string; file: Milestone },
  readText: (path: string) => Promise<string | null>,
  today: string,
): Promise<Result<MilestoneDocument>> {
  if (milestone.file.state === "closed") {
    const markdown = await readText(evidencePath(project, slug));
    const document = markdown === null ? null : parseEvidence(markdown);
    const red = (document?.gates ?? []).filter((g) => g.verdict === "red").map((g) => g.name);
    return ok({ state: "closed", document, red, markdown });
  }
  const evidence = projectEvidence(project, cases, slug, milestone, { closed: null, today });
  if (!evidence.ok) return evidence;
  return ok({
    state: "open",
    document: evidenceDocument(evidence.value),
    red: redGates(evidence.value),
    markdown: renderEvidence(evidence.value),
  });
}
