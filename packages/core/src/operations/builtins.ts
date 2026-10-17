import { junitIngester } from "../ingest/junit.js";
import { ingestOperation } from "../ingest/operation.js";
import { coverOperation } from "./cover.js";
import { idNextOperation } from "./id-next.js";
import { initOperation } from "./init.js";
import type { Operation } from "./operation.js";
import { overviewOperation } from "./overview.js";
import { projectAddOperation } from "./project-add.js";
import { queryOperation } from "./query.js";
import { resolveOperation } from "./resolve.js";
import { validateOperation } from "./validate.js";

/** Core's own operations; hosts register them like any extension's (ADR extension-model). */
export const builtinOperations: readonly Operation[] = [
  initOperation,
  projectAddOperation,
  validateOperation,
  resolveOperation,
  queryOperation,
  idNextOperation,
  overviewOperation,
  coverOperation,
  ingestOperation(junitIngester),
];
