import { initOperation } from "./init.js";
import type { Operation } from "./operation.js";
import { projectAddOperation } from "./project-add.js";

/** Core's own operations; hosts register them like any extension's (ADR extension-model). */
export const builtinOperations: readonly Operation[] = [initOperation, projectAddOperation];
