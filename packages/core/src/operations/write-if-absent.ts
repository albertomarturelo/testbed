import type { OperationContext } from "./operation.js";

/**
 * Writes `path` only when nothing is there, so setup operations are idempotent
 * and never overwrite (ADR agent-driven-setup). Returns whether it wrote.
 */
export async function writeIfAbsent(
  context: OperationContext,
  path: string,
  text: string,
): Promise<boolean> {
  if (await context.exists(path)) return false;
  await context.writeText(path, text);
  return true;
}
