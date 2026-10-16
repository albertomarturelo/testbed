import { z } from "zod";
import { CommonFile } from "./common.js";
import { Slug } from "./primitives.js";

/** npm package name, optionally scoped. */
const PackageName = z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);

/** A project of the workspace: a directory holding `context/tests/` (ADR workspace-and-projects). */
export const ProjectEntry = z.strictObject({
  /** Unique in the workspace; qualifies ids across projects (`web/TC-0003`). */
  name: Slug,
  /** POSIX path relative to `casefile.yaml`; `.` in a single-project repo. */
  path: z.string().min(1),
});

/**
 * `casefile.yaml` at the workspace root: lists the projects, the extensions
 * (ADR extension-model) and the workspace-level commons. `projects` may be empty
 * right after `init`; the validator requires at least one.
 */
export const Config = z.strictObject({
  version: z.literal(1),
  projects: z.array(ProjectEntry),
  extensions: z.array(PackageName).optional(),
  commons: CommonFile.optional(),
});

export type ProjectEntry = z.infer<typeof ProjectEntry>;
export type Config = z.infer<typeof Config>;
