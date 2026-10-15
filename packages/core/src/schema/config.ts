import { z } from "zod";

/** npm package name, optionally scoped. */
const PackageName = z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);

/** `casefile.yaml`: marks the repo root and lists extensions (ADR extension-model). */
export const Config = z.strictObject({
  version: z.literal(1),
  extensions: z.array(PackageName).optional(),
});

export type Config = z.infer<typeof Config>;
