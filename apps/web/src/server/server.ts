import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import {
  type CasefileError,
  fail,
  type Identity,
  inputFields,
  openRegistry,
  type Result,
} from "@casefile/core";
import { commitAsHuman, type ReturnedCommit } from "./git.js";

export type UiServerOptions = {
  /** Absolute path of the workspace root (the directory holding `casefile.yaml`). */
  root: string;
  /** Directory of the built client (`dist/client`). */
  clientDir: string;
  /** Who the QA is, as the host resolved it (ADR identity-override); `null` when nobody is. */
  identity: Identity | null;
  /** The environment git runs with (tests isolate it). */
  env?: NodeJS.ProcessEnv;
};

const API_PREFIX = "/api/operations/";
const SESSION_PATH = "/api/session";

/** The header a writing request carries the session token in (never a URL). */
export const TOKEN_HEADER = "x-casefile-token";

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

/** What one started server knows beyond its options. */
type Session = UiServerOptions & { token: string };

/**
 * The local UI's host (ADR local-ui-stack): serves the built client and runs
 * registry operations as `POST /api/operations/<name>`, answering the `Result`
 * that `casefile <command> --json` prints. Reads are open to any local page;
 * a write needs the page's own origin and the token `GET /api/session` hands
 * it, and its commit is then run as the human (ADR
 * human-writes-through-operations §2–3). The caller binds it to 127.0.0.1;
 * requests naming another host are refused (DNS rebinding).
 */
export function createUiServer(options: UiServerOptions): Server {
  const session: Session = { ...options, token: randomBytes(32).toString("base64url") };
  return createServer((request, response) => {
    handle(request, response, session).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      send(response, 500, fail({ code: "ui.internal", message }));
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  session: Session,
): Promise<void> {
  if (!isLocalHost(request.headers.host)) {
    send(response, 403, fail({ code: "ui.forbidden_host", message: "only localhost is served" }));
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === SESSION_PATH) {
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" }).end();
      return;
    }
    send(response, 200, { ok: true, value: sessionView(session) });
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    const [status, result] = await api(request, url.pathname, session);
    send(response, status, result);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  await serveStatic(response, url.pathname, session.clientDir);
}

/** What the page learns at start: its token and who it acts as. */
function sessionView(session: Session) {
  const { identity } = session;
  return {
    token: session.token,
    identity:
      identity === null
        ? null
        : {
            email: identity.email,
            source: identity.source,
            ...(identity.name === undefined ? {} : { name: identity.name }),
          },
  };
}

async function api(
  request: IncomingMessage,
  pathname: string,
  session: Session,
): Promise<[number, Result<unknown>]> {
  const { root } = session;
  const name = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : "";
  if (request.method !== "POST" || name === "" || name.includes("/")) {
    return [404, fail(error("ui.not_found", "use POST /api/operations/<name>"))];
  }
  const host = await openRegistry(root);
  const operation = host.registry.get(name);
  if (operation === undefined) {
    return [404, fail(error("ui.unknown_operation", `no operation named '${name}'`))];
  }
  const writes = operation.writes.length > 0;
  if (writes && !isAllowedWrite(request, session.token)) {
    return [
      403,
      fail(
        error(
          "ui.forbidden",
          `'${name}' writes files: only the UI's own page may ask, with the session token`,
        ),
      ),
    ];
  }
  const body = await readJson(request);
  if (!body.ok) return [400, body];
  // A host input is not the user's to give, except the project: the UI's
  // project selector plays the part of `--project` (ADR cli-generic-host §3).
  const fields = inputFields(operation);
  const hostOnly = new Set(
    fields.filter((f) => f.host !== undefined && f.host !== "project").map((f) => f.name),
  );
  const input = Object.fromEntries(Object.entries(body.value).filter(([k]) => !hostOnly.has(k)));
  for (const field of fields) {
    const value = hostValue(field.host, name, session.identity);
    if (value !== undefined) input[field.name] = value;
  }
  const outcome = await host.registry.invoke(name, input, { root, actor: "human" });
  if (!writes || !outcome.ok) return [200, outcome];
  return commitIfReturned(outcome.value, session);
}

/** The values the viewer fills in for the human (ADR identity-override §3–4). */
function hostValue(host: string | undefined, operation: string, identity: Identity | null) {
  switch (host) {
    case "identity":
      return identity?.email;
    case "via":
      return `ui:${operation}`;
    default:
      return undefined;
  }
}

/**
 * A write must come from the UI's own page: same origin (`Origin`, or the
 * browser's `Sec-Fetch-Site`) and the token handed to it at start. Any other
 * local page gets `ui.forbidden`.
 */
function isAllowedWrite(request: IncomingMessage, token: string): boolean {
  const presented = request.headers[TOKEN_HEADER];
  if (typeof presented !== "string" || !sameSecret(presented, token)) return false;
  if (request.headers["sec-fetch-site"] === "same-origin") return true;
  const { origin, host } = request.headers;
  return typeof origin === "string" && host !== undefined && origin === `http://${host}`;
}

/** Constant-time enough for a per-start token: equal length, then every byte. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A writing operation returns `commit` (ADR agent-runs-the-commit); the server
 * runs it for the human and adds the sha. Without one, nothing was written.
 */
async function commitIfReturned(
  value: unknown,
  session: Session,
): Promise<[number, Result<unknown>]> {
  const commit = returnedCommit(value);
  if (commit === null) return [200, { ok: true, value }];
  const made = await commitAsHuman(session.root, commit, session.identity, session.env);
  if (!made.ok) return [500, made];
  const output = value as Record<string, unknown>;
  return [200, { ok: true, value: { ...output, commit: { ...commit, sha: made.value.sha } } }];
}

function returnedCommit(value: unknown): ReturnedCommit | null {
  const commit = (value as { commit?: unknown } | null)?.commit;
  if (commit === null || typeof commit !== "object") return null;
  const { message, files } = commit as { message?: unknown; files?: unknown };
  const paths = Array.isArray(files) ? files.filter((f) => typeof f === "string") : [];
  return typeof message === "string" && paths.length > 0 ? { message, files: paths } : null;
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
    .writeHead(status, {
      "content-type": CONTENT_TYPES[".json"],
      // JSON is never a script: another origin cannot read the session by embedding it.
      "x-content-type-options": "nosniff",
    })
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
