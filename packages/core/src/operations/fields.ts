import type { z } from "zod";
import type { Operation } from "./operation.js";

/**
 * Inputs a host fills in instead of the user (ADR cli-generic-host): the running
 * casefile version, the bundled skill files, the current project.
 */
export const HOST_INPUTS = ["version", "skills", "project"] as const;
export type HostInput = (typeof HOST_INPUTS)[number];

/** One top-level input field of an operation, as hosts render it (CLI flags, forms). */
export type InputField = {
  name: string;
  /** `json`: any shape without a plain rendering (objects, arrays of objects). */
  kind: "string" | "number" | "boolean" | "json";
  /** An array of strings or numbers: the flag repeats. */
  multiple: boolean;
  required: boolean;
  /** Allowed values of an enum (or of the elements of an array of enums). */
  choices?: string[];
  /** Set when the host supplies the value, from `.meta({ host })`. */
  host?: HostInput;
};

type Def = {
  type: string;
  innerType?: z.ZodType;
  in?: z.ZodType;
  element?: z.ZodType;
  entries?: Record<string, string | number>;
};

/** Wrappers that do not change what a value looks like on the command line. */
const WRAPPERS = new Set(["optional", "default", "prefault", "nullable", "readonly", "catch"]);

/** The top-level fields of an operation's input, in declaration order; `[]` if it is not an object. */
export function inputFields(operation: Pick<Operation, "input">): InputField[] {
  const shape = (operation.input as { shape?: Record<string, z.ZodType> }).shape ?? {};
  return Object.entries(shape).map(([name, schema]) => {
    const meta = schema.meta() as { host?: unknown } | undefined;
    const host = HOST_INPUTS.find((h) => h === meta?.host);
    const base = unwrap(schema);
    const element = def(base).type === "array" ? unwrap(def(base).element as z.ZodType) : null;
    const scalar = element ?? base;
    const kind = scalarKind(scalar);
    const multiple = element !== null && kind !== "json" && kind !== "boolean";
    const field: InputField = {
      name,
      kind: element !== null && !multiple ? "json" : kind,
      multiple,
      required: !schema.safeParse(undefined).success,
    };
    const entries = def(scalar).entries;
    if (entries !== undefined && (element === null || multiple)) {
      field.choices = Object.values(entries).map(String);
    }
    if (host !== undefined) field.host = host;
    return field;
  });
}

function def(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    const d = def(current);
    if (WRAPPERS.has(d.type) && d.innerType !== undefined) current = d.innerType;
    else if (d.type === "pipe" && d.in !== undefined) current = d.in;
    else return current;
  }
}

function scalarKind(schema: z.ZodType): InputField["kind"] {
  switch (def(schema).type) {
    case "string":
    case "enum":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "json";
  }
}
