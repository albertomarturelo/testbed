import { z } from "zod";
import { PropertyKey } from "./primitives.js";

const MirrorFields = z.strictObject({
  zephyr: z.string().min(1).optional(),
  xray: z.string().min(1).optional(),
  testrail: z.string().min(1).optional(),
});

const base = {
  description: z.string().optional(),
  mirror: MirrorFields.optional(),
};

/** One custom property. That `default` is valid for its type is checked by the validator. */
export const PropertyDefinition = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("string"), default: z.string().optional(), ...base }),
  z.strictObject({ type: z.literal("number"), default: z.number().optional(), ...base }),
  z.strictObject({ type: z.literal("boolean"), default: z.boolean().optional(), ...base }),
  z.strictObject({
    type: z.literal("enum"),
    values: z.array(z.string().min(1)).min(1),
    default: z.string().optional(),
    ...base,
  }),
  z.strictObject({
    type: z.literal("list"),
    values: z.array(z.string().min(1)).min(1).optional(),
    default: z.array(z.string()).optional(),
    ...base,
  }),
]);

/** `context/tests/_properties.yaml`. */
export const PropertiesFile = z.strictObject({
  properties: z.record(PropertyKey, PropertyDefinition),
});

export type PropertyDefinition = z.infer<typeof PropertyDefinition>;
export type PropertiesFile = z.infer<typeof PropertiesFile>;
