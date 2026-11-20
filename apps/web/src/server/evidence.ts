import { randomUUID } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync } from "node:fs";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  type CasefileError,
  type EvidenceKind,
  evidenceEntryProblems,
  evidenceKind,
  evidenceLimits,
  extensionOf,
  fail,
  isScriptExtension,
  loadWorkspace,
  namedStoredEvidence,
  openRegistry,
  type Result,
  storedEvidenceName,
} from "@casefile/core";

// The viewer's side of ADR run-evidence-files §6–7: files reach `run` as
// uploads staged outside the repository, and stored evidence is served
// read-only. The rules (limits, kinds, which refs are stored files) are core's.

/** The header an upload names its file in, URI-encoded (a raw body has no name). */
export const FILENAME_HEADER = "x-casefile-filename";

/** How long an upload waits for the `run` that names it. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;

/** What `POST /api/evidence` answers. */
export type Uploaded = { upload: string; name: string; size: number; kind: EvidenceKind };

type Staged = { file: string; name: string; size: number; kind: EvidenceKind; at: number };

/**
 * The uploads of one server, in one directory under the OS temp dir (never the
 * repository), made on the first upload. An upload goes when the `run` naming
 * it is recorded, after `UPLOAD_TTL_MS`, or when the server closes.
 */
export class UploadStage {
  readonly #now: () => number;
  readonly #uploads = new Map<string, Staged>();
  #dir: string | null = null;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Streams one request body into the stage, applying the workspace's limits. */
  async receive(request: IncomingMessage, root: string): Promise<[number, Result<Uploaded>]> {
    this.sweep();
    const header = request.headers[FILENAME_HEADER];
    const name = typeof header === "string" ? originalName(header) : null;
    if (name === null) {
      return [
        400,
        fail(
          invalid(
            `name the file in the ${FILENAME_HEADER} header, URI-encoded; the body is its bytes`,
          ),
        ),
      ];
    }
    const limits = evidenceLimits((await openRegistry(root)).config?.evidence);
    const problems = evidenceEntryProblems([{ field: "file", file: name }], limits.extensions);
    if (problems.length > 0) return [400, fail(...problems.map(withoutField))];
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limits.maxBytes) {
      return [413, fail(tooLarge(name, declared, limits.maxBytes))];
    }

    const upload = randomUUID();
    const dir = join(this.#directory(), upload);
    await mkdir(dir);
    const file = join(dir, storedEvidenceName(name));
    const handle = await open(file, "wx");
    let size = 0;
    try {
      // Read to the end even past the limit: the page gets the answer, not a reset.
      for await (const chunk of request) {
        size += (chunk as Buffer).length;
        if (size <= limits.maxBytes) await handle.write(chunk as Buffer);
      }
    } finally {
      await handle.close();
    }
    if (size > limits.maxBytes) {
      await rm(dir, { recursive: true, force: true });
      return [413, fail(tooLarge(name, size, limits.maxBytes))];
    }
    const kind = evidenceKind(extensionOf(name));
    this.#uploads.set(upload, { file, name, size, kind, at: this.#now() });
    return [200, { ok: true, value: { upload, name, size, kind } }];
  }

  /** The staged file of an upload that has not expired; `null` otherwise. */
  file(upload: string): string | null {
    this.sweep();
    return this.#uploads.get(upload)?.file ?? null;
  }

  /** Removes uploads, once the `run` naming them is recorded. */
  async remove(uploads: readonly string[]): Promise<void> {
    for (const upload of uploads) {
      const staged = this.#uploads.get(upload);
      if (staged === undefined) continue;
      this.#uploads.delete(upload);
      await rm(join(staged.file, ".."), { recursive: true, force: true });
    }
  }

  /** Removes the uploads older than `UPLOAD_TTL_MS`. */
  sweep(): void {
    const now = this.#now();
    for (const [upload, staged] of this.#uploads) {
      if (now - staged.at < UPLOAD_TTL_MS) continue;
      this.#uploads.delete(upload);
      rmSync(join(staged.file, ".."), { recursive: true, force: true });
    }
  }

  /** Removes every upload and the stage itself (the server closes). Synchronous: the process may exit next. */
  clear(): void {
    this.#uploads.clear();
    if (this.#dir !== null) rmSync(this.#dir, { recursive: true, force: true });
    this.#dir = null;
  }

  /** Made once, synchronously, so two first uploads share it. */
  #directory(): string {
    this.#dir ??= mkdtempSync(join(tmpdir(), "casefile-uploads-"));
    return this.#dir;
  }
}

/**
 * `run`'s `attach` with each `{ upload, label? }` swapped for the staged
 * `{ file, label? }` (ADR run-evidence-files §6), and the uploads it named.
 * Other keys pass through, so core refuses them as it would. An upload that is
 * unknown or expired is `ui.upload_unknown` on its `attach.<i>`.
 */
export function swapUploads(
  input: Record<string, unknown>,
  stage: UploadStage,
): Result<{ input: Record<string, unknown>; uploads: string[] }> {
  const attach = input.attach;
  if (!Array.isArray(attach)) return { ok: true, value: { input, uploads: [] } };
  const uploads: string[] = [];
  const errors: CasefileError[] = [];
  const swapped = attach.map((item: unknown, i) => {
    if (item === null || typeof item !== "object" || !("upload" in item)) return item;
    const { upload, ...rest } = item as Record<string, unknown>;
    const file = typeof upload === "string" ? stage.file(upload) : null;
    if (file === null) {
      errors.push({
        code: "ui.upload_unknown",
        field: `attach.${i}`,
        message: `no upload ${JSON.stringify(upload)}: uploads expire after an hour and go once a result names them; upload the file again`,
      });
      return item;
    }
    uploads.push(upload as string);
    return { ...rest, file };
  });
  if (errors.length > 0) return fail(...errors);
  return { ok: true, value: { input: { ...input, attach: swapped }, uploads } };
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  har: "application/json; charset=utf-8",
};

/**
 * `GET /api/evidence?ref=<workspace-relative ref>` (ADR run-evidence-files §7):
 * the file, only when a run event names `ref` as a file `run` stored inside a
 * `.runs/<run-id>/` directory, its extension is allowed and never a script
 * type, and the path is a regular file reached without a symlink. Anything
 * else is `ui.evidence_not_found`: the answer does not say which rule failed.
 */
export async function serveEvidence(
  response: ServerResponse,
  url: URL,
  root: string,
): Promise<Result<unknown> | null> {
  const ref = url.searchParams.get("ref") ?? "";
  const missing = fail({
    code: "ui.evidence_not_found",
    message: `no stored evidence file named '${ref}' by a run event`,
  });
  const extension = extensionOf(ref);
  if (ref === "" || isScriptExtension(extension)) return missing;
  const workspace = await loadWorkspace(root);
  const { extensions } = evidenceLimits(workspace.config?.evidence);
  if (!extensions.includes(extension) || namedStoredEvidence(workspace, ref) === null) {
    return missing;
  }
  const file = join(root, ...ref.split("/"));
  try {
    const stats = await lstat(file);
    // The real path is the path itself: no symlink anywhere on the way.
    if (
      !stats.isFile() ||
      (await realpath(file)) !== join(await realpath(root), ...ref.split("/"))
    ) {
      return missing;
    }
    const kind = evidenceKind(extension);
    const base = posix.basename(ref).replace(/[^A-Za-z0-9._-]/g, "_");
    response.writeHead(200, {
      "content-type": MEDIA_TYPES[extension] ?? "application/octet-stream",
      "content-length": stats.size,
      "x-content-type-options": "nosniff",
      "content-disposition": `${kind === "file" ? "attachment" : "inline"}; filename="${base}"`,
      "cache-control": "no-store",
    });
    // Past the headers an error can only cut the answer short.
    await pipeline(createReadStream(file), response).catch(() => response.destroy());
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") return missing;
    throw error;
  }
}

/** The base name the header gives, decoded; `null` when there is none to keep. */
function originalName(header: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(header);
  } catch {
    return null;
  }
  const base = posix.basename(decoded.replaceAll("\\", "/")).trim();
  return base === "" || base.includes("\0") ? null : base;
}

function tooLarge(name: string, size: number, max: number): CasefileError {
  return {
    code: "evidence.too_large",
    message: `${name} is ${megabytes(size)} MB; evidence files are at most ${megabytes(max)} MB (evidence.max_file_mb in casefile.yaml); attach a long video as a link`,
  };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

function withoutField({ field: _, ...error }: CasefileError): CasefileError {
  return error;
}

function invalid(message: string): CasefileError {
  return { code: "ui.invalid_input", message };
}
