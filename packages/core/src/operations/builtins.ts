import { junitIngester } from "../ingest/junit.js";
import { ingestOperation } from "../ingest/operation.js";
import { coverOperation } from "./cover.js";
import { idNextOperation } from "./id-next.js";
import { initOperation } from "./init.js";
import { milestoneCloseOperation } from "./milestone-close.js";
import { milestoneOpenOperation } from "./milestone-open.js";
import { milestoneReportOperation } from "./milestone-report.js";
import type { Operation } from "./operation.js";
import { overviewOperation } from "./overview.js";
import { projectAddOperation } from "./project-add.js";
import { queryOperation } from "./query.js";
import { resolveOperation } from "./resolve.js";
import { reviewOperation } from "./review.js";
import { runOperation } from "./run.js";
import { runsOperation } from "./runs.js";
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
  runsOperation,
  coverOperation,
  reviewOperation,
  runOperation,
  milestoneOpenOperation,
  milestoneReportOperation,
  milestoneCloseOperation,
  ingestOperation(junitIngester),
];
