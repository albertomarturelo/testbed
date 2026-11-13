import { z } from "zod";
import { fail, ok, type Result } from "../errors.js";
import type { LoadedProject } from "../load/workspace.js";

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
