#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findWorkspaceRoot } from "@casefile/core";
import { createUiServer } from "./server.js";

/** Default port of the local UI (ADR local-ui-stack §2). */
const DEFAULT_PORT = 4321;

const USAGE = `Usage: casefile-web [--cwd <dir>] [--port <n>]

Serves the read-only casefile UI for the workspace containing --cwd on
http://127.0.0.1:<port> (default ${DEFAULT_PORT}).`;

const CLIENT_DIR = fileURLToPath(new URL("../client/", import.meta.url));

function fatal(message: string): never {
  process.stderr.write(`casefile-web: ${message}\n`);
  process.exit(1);
}

let values: { cwd?: string; port?: string; help?: boolean };
try {
  ({ values } = parseArgs({
    options: {
      cwd: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  }));
} catch (error) {
  fatal(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
}
if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  fatal(`--port must be 0–65535, not '${values.port}'`);

const located = await findWorkspaceRoot(resolve(process.cwd(), values.cwd ?? "."));
if (!located.ok) fatal(located.errors.map((e) => e.message).join("\n"));
const root = located.value;

const server = createUiServer({ root, clientDir: CLIENT_DIR });
server.on("error", (error: NodeJS.ErrnoException) => {
  fatal(error.code === "EADDRINUSE" ? `port ${port} is in use: pass --port <n>` : error.message);
});
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actual = typeof address === "object" && address !== null ? address.port : port;
  process.stdout.write(`casefile UI for ${root}\n  http://127.0.0.1:${actual}\n`);
});
