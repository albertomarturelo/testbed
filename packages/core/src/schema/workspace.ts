import { z } from "zod";
import { Slug } from "./primitives.js";

/** `casefile.workspace.yaml`: repos a release aggregates (mobile, web, backend…). */
export const Workspace = z.strictObject({
  repos: z
    .array(
      z.strictObject({
        name: Slug,
        /** Local checkout, relative to the workspace file. */
        path: z.string().min(1),
        url: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

export type Workspace = z.infer<typeof Workspace>;
