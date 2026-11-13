import { z } from "zod";
import { CommonFile } from "./common.js";
import { Slug } from "./primitives.js";

/** npm package name, optionally scoped. */
export const PackageName = z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);

/** A project of the workspace: a directory holding `context/tests/` (ADR workspace-and-projects). */
export const ProjectEntry = z.strictObject({
  /** Unique in the workspace; qualifies ids across projects (`web/TC-0003`). */
  name: Slug,
  /** POSIX path relative to `casefile.yaml`; `.` in a single-project repo. */
  path: z.string().min(1),
});

/**
 * How the commits casefile hands back look in this repository (ADR
 * commit-shape-follows-host-repo). Structural only: the validator checks the
 * template's placeholders and that the regex compiles.
 */
export const CommitConfig = z.strictObject({
  /** Subject template: `{type}`, `{scope}`, `{summary}`, `{ticket}`. Default `{type}({scope}): {summary}`. */
  subject: z.string().min(1).optional(),
  /** Regex over the current branch; its first capture group (else the match) is the ticket. */
  ticket_from_branch: z.string().min(1).optional(),
  /** The ticket when none is typed and the branch has none. */
  ticket_default: z.string().min(1).optional(),
});

/**
 * `casefile.yaml` at the workspace root: lists the projects, the extensions
 * (ADR extension-model), the workspace-level commons and the commit shape.
 * `projects` may be empty right after `init`; the validator requires at least one.
 */
export const Config = z.strictObject({
  version: z.literal(1),
  projects: z.array(ProjectEntry),
  extensions: z.array(PackageName).optional(),
  commons: CommonFile.optional(),
  commit: CommitConfig.optional(),
});

export type ProjectEntry = z.infer<typeof ProjectEntry>;
export type Config = z.infer<typeof Config>;
export type CommitConfig = z.infer<typeof CommitConfig>;
