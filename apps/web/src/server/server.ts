import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { type CasefileError, fail, inputFields, openRegistry, type Result } from "@casefile/core";

export type UiServerOptions = {
  /** Absolute path of the workspace root (the directory holding `casefile.yaml`). */
  root: string;
  /** Directory of the built client (`dist/client`). */
  clientDir: string;
};

const API_PREFIX = "/api/operations/";

/** Request bodies are operation inputs: small JSON objects. */
const MAX_BODY_BYTES = 64 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

/**
 * The local UI's host (ADR local-ui-stack): serves the built client and runs
 * read-only registry operations as `POST /api/operations/<name>`, answering the
 * `Result` that `casefile <command> --json` prints. The caller binds it to
 * 127.0.0.1; requests naming another host are refused (DNS rebinding).
 */
export function createUiServer(options: UiServerOptions): Server {
  return createServer((request, response) => {
    handle(request, response, options).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      send(response, 500, fail({ code: "ui.internal", message }));
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: UiServerOptions,
): Promise<void> {
  if (!isLocalHost(request.headers.host)) {
    send(response, 403, fail({ code: "ui.forbidden_host", message: "only localhost is served" }));
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const [status, result] = await api(request, url.pathname, options.root);
    send(response, status, result);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  await serveStatic(response, url.pathname, options.clientDir);
}

async function api(
  request: IncomingMessage,
  pathname: string,
  root: string,
): Promise<[number, Result<unknown>]> {
  const name = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : "";
  if (request.method !== "POST" || name === "" || name.includes("/")) {
    return [404, fail(error("ui.not_found", "use POST /api/operations/<name>"))];
  }
  const host = await openRegistry(root);
  const operation = host.registry.get(name);
  if (operation === undefined) {
    return [404, fail(error("ui.unknown_operation", `no operation named '${name}'`))];
  }
  if (operation.writes.length > 0) {
    return [403, fail(error("ui.read_only", `'${name}' writes files; the UI is read-only`))];
  }
  const body = await readJson(request);
  if (!body.ok) return [400, body];
  // A host input is not the user's to give, except the project: the UI's
  // project selector plays the part of `--project` (ADR cli-generic-host §3).
  const hostOnly = new Set(
    inputFields(operation)
      .filter((field) => field.host !== undefined && field.host !== "project")
      .map((field) => field.name),
  );
  const input = Object.fromEntries(Object.entries(body.value).filter(([k]) => !hostOnly.has(k)));
  return [200, await host.registry.invoke(name, input, { root, actor: "human" })];
}

async function readJson(request: IncomingMessage): Promise<Result<Record<string, unknown>>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return fail(error("ui.invalid_input", "the request is too large"));
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const value: unknown = text.trim() === "" ? {} : JSON.parse(text);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return { ok: true, value: value as Record<string, unknown> };
    }
  } catch {
    // Reported below like any other non-object body.
  }
  return fail(error("ui.invalid_input", "the body must be a JSON object: the operation's input"));
}

async function serveStatic(response: ServerResponse, pathname: string, clientDir: string) {
  let decoded: string | null;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = null; // a malformed `%` escape names no file
  }
  const relative = decoded === null ? "" : normalize(decoded).replace(/^([/\\])+/, "");
  const inside = !relative.split(sep).includes("..");
  const file = inside && relative !== "" ? join(clientDir, relative) : null;
  const asset = file === null ? null : await readFile(file).catch(() => null);
  if (asset !== null && file !== null) {
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    });
    response.end(asset);
    return;
  }
  // Views live in the URL hash, so every other path is the app itself.
  const index = await readFile(join(clientDir, "index.html")).catch(() => null);
  if (index === null) {
    response
      .writeHead(503, { "content-type": "text/plain; charset=utf-8" })
      .end("The UI is not built: run `pnpm build`.\n");
    return;
  }
  response.writeHead(200, { "content-type": CONTENT_TYPES[".html"] }).end(index);
}

function send(response: ServerResponse, status: number, result: Result<unknown>) {
  response
    .writeHead(status, { "content-type": CONTENT_TYPES[".json"] })
    .end(JSON.stringify(result));
}

/** `localhost`, `127.0.0.1` or `[::1]`, with any port. */
function isLocalHost(header: string | undefined): boolean {
  if (header === undefined) return false;
  const name = header.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

function error(code: string, message: string): CasefileError {
  return { code, message };
}
