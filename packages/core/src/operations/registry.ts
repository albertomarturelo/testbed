import type { z } from "zod";
import { type CasefileError, fail, ok, type Result } from "../errors.js";
import { Slug } from "../schema/index.js";
import { createContext, PathRefused } from "./context.js";
import type { Actor, Operation } from "./operation.js";

const ACTORS: readonly Actor[] = ["human", "agent", "ci"];

export type InvokeOptions = {
  /** Absolute path of the workspace root. */
  root: string;
  actor: Actor;
};

/**
 * The operations a host can render and run. Built-ins and extensions register
 * through the same `register` (ADR extension-model); core enforces each
 * operation's `actor` and `writes` on `invoke`.
 */
export type Registry = {
  register(operation: Operation): Result<void>;
  get(name: string): Operation | undefined;
  list(): Operation[];
  /** Runs an operation; every failure comes back as error values, never as a throw. */
  invoke(name: string, input: unknown, options: InvokeOptions): Promise<Result<unknown>>;
};

export function createRegistry(): Registry {
  const operations = new Map<string, Operation>();

  return {
    register(operation) {
      const problems = definitionProblems(operation);
      if (problems.length > 0) {
        return fail(
          ...problems.map(
            (message): CasefileError => ({ code: "operation.invalid_definition", message }),
          ),
        );
      }
      if (operations.has(operation.name)) {
        return fail({
          code: "operation.duplicate",
          message: `an operation named '${operation.name}' is already registered`,
        });
      }
      operations.set(operation.name, operation);
      return ok(undefined);
    },

    get: (name) => operations.get(name),

    list: () => [...operations.values()].sort((a, b) => a.name.localeCompare(b.name)),

    async invoke(name, input, { root, actor }) {
      const operation = operations.get(name);
      if (operation === undefined) {
        return fail({ code: "operation.unknown", message: `no operation named '${name}'` });
      }
      if (!operation.actor.includes(actor)) {
        return fail({
          code: "operation.actor_not_allowed",
          message: `'${name}' may be invoked by ${operation.actor.join(", ")}, not ${actor}`,
        });
      }
      const parsedInput = operation.input.safeParse(input);
      if (!parsedInput.success) {
        return fail(...issues("operation.invalid_input", parsedInput.error.issues));
      }

      let result: Result<unknown>;
      try {
        result = await operation.run(
          parsedInput.data,
          createContext(root, actor, operation.writes),
        );
      } catch (error) {
        if (error instanceof PathRefused) {
          return fail({ code: error.code, path: error.path, message: error.message });
        }
        return fail({
          code: "operation.failed",
          message: `'${name}' failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      if (!result.ok) return result;

      const parsedOutput = operation.output.safeParse(result.value);
      if (!parsedOutput.success) {
        return fail(...issues("operation.invalid_output", parsedOutput.error.issues));
      }
      return ok(parsedOutput.data);
    },
  };
}

function definitionProblems(operation: Operation): string[] {
  const problems: string[] = [];
  const name = typeof operation.name === "string" ? operation.name : String(operation.name);
  if (!Slug.safeParse(operation.name).success) problems.push(`name '${name}' is not a slug`);
  if (typeof operation.run !== "function") problems.push(`'${name}' has no run()`);
  if (typeof operation.input?.safeParse !== "function")
    problems.push(`'${name}' has no input schema`);
  if (typeof operation.output?.safeParse !== "function") {
    problems.push(`'${name}' has no output schema`);
  }
  if (!Array.isArray(operation.actor) || operation.actor.length === 0) {
    problems.push(`'${name}' declares no actor`);
  } else {
    for (const actor of operation.actor) {
      if (!ACTORS.includes(actor)) problems.push(`'${name}' declares unknown actor '${actor}'`);
    }
  }
  if (!Array.isArray(operation.writes)) problems.push(`'${name}' declares no writes list`);
  const shape = (operation.input as { shape?: Record<string, unknown> })?.shape;
  if (operation.subject !== undefined && shape !== undefined && !(operation.subject in shape)) {
    problems.push(`'${name}' names subject '${operation.subject}', which is not an input field`);
  }
  if (typeof operation.spec !== "string" || operation.spec === "") {
    problems.push(`'${name}' declares no spec`);
  }
  return problems;
}

function issues(code: string, list: z.ZodError["issues"]): CasefileError[] {
  return list.map((issue) => ({
    code,
    message: issue.message,
    ...(issue.path.length === 0 ? {} : { field: issue.path.join(".") }),
  }));
}
