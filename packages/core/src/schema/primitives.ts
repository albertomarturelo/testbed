import { z } from "zod";

/** `TC-0001` and up; at least four digits. */
export const CaseId = z.string().regex(/^TC-[0-9]{4,}$/);

/** Slug path mirroring the folder under `context/tests/`, e.g. `payments/refunds`. */
export const FeatureSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/);

/** Key of a custom property or label, e.g. `risk`, `owner_team`. */
export const PropertyKey = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** Permissive `local@domain`; identity is whatever `git config user.email` says. */
export const Email = z.string().regex(/^[^@\s]+@[^@\s]+$/);

/** ISO 8601 timestamp with `Z` or an explicit offset. */
export const Timestamp = z.iso.datetime({ offset: true });

/** Calendar date `YYYY-MM-DD`. */
export const CalendarDate = z.iso.date();

/** Change id linking history events and inbox results to commits (ADR history-commit-reference). */
export const ChangeId = z.uuid();

/** Safe for file names: run ids, inbox ids. */
export const FileSafeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/** Exact semver: `.casefile/package.json` pins, never ranges (ADR casefile-toolchain-dir). */
export const ExactVersion = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "an exact semver version");

/** Lowercase slug for open vocabularies such as inbox kinds. */
export const Slug = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const Surface = z.enum([
  "web",
  "mobile-ios",
  "mobile-android",
  "backend",
  "api",
  "cli",
  "desktop",
]);

export const Layer = z.enum(["e2e", "integration", "api", "ui", "unit", "manual-exploratory"]);

export const Priority = z.enum(["P0", "P1", "P2", "P3"]);

/** Association to a sprint, story, release…: `sprint:23`, `story:PROJ-1234`, `release:web-4.12.0`. */
export const WorkItem = z.string().regex(/^[a-z][a-z0-9_-]*:\S+$/);

/** Value of a label; the allowed type per key is declared in `_properties.yaml`. */
export const LabelValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const Labels = z.record(PropertyKey, LabelValue);

/** Fixture values referenced from steps as `{{data.x}}`. */
export const Data = z.record(PropertyKey, z.unknown());

/** `human:ana@example.com`, `agent:claude-code`, `ci:github-actions`. */
export const Executor = z.string().regex(/^(human|agent|ci):.+$/);
