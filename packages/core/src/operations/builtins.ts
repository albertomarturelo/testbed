import { initOperation } from "./init.js";
import type { Operation } from "./operation.js";
import { projectAddOperation } from "./project-add.js";
import { validateOperation } from "./validate.js";

/** Core's own operations; hosts register them like any extension's (ADR extension-model). */
export const builtinOperations: readonly Operation[] = [
  initOperation,
  projectAddOperation,
  validateOperation,
];
