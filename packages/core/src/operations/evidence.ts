import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { CasefileError } from "../errors.js";
import { TESTS_DIR } from "../load/paths.js";
import type { EvidenceConfig } from "../schema/index.js";

// The rules of ADR run-evidence-files §2–4, pure: `run` reads and writes the
// files, `validate` hashes the stored ones, the viewer's upload (#204) applies
// the same limits.

/** Allowed extensions when `casefile.yaml` sets no `evidence.extensions`. */
export const EVIDENCE_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "mp4",
  "webm",
  "pdf",
  "txt",
  "log",
  "json",
  "har",
];

/** Types a browser runs as script: refused even when listed, since the viewer would render them. */
export const SCRIPT_EXTENSIONS: readonly string[] = [
  "svg",
  "htm",
  "html",
  "xhtml",
  "xml",
  "js",
  "mjs",
];

/** Largest evidence file when `evidence.max_file_mb` is not set. */
export const EVIDENCE_MAX_FILE_MB = 10;

/** Most evidence entries (files and links) one event carries. */
export const EVIDENCE_MAX_ENTRIES = 20;

/** Longest stored name after the `<sha8>-` prefix. */
const NAME_MAX = 60;

const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const VIDEOS = new Set(["mp4", "webm"]);

/** The kinds `run` gives a stored file; `validate` checks only these. */
export const EVIDENCE_FILE_KINDS: readonly string[] = ["image", "video", "file"];

export type EvidenceKind = "image" | "video" | "file";

/** An extension as compared: lower-case, without leading dots. */
export function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\.+/, "").toLowerCase();
}

/** The extension of a file name, normalized; `""` when it has none. */
export function extensionOf(name: string): string {
  const base = posix.basename(name.replaceAll("\\", "/"));
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : normalizeExtension(base.slice(dot + 1));
}

export function isScriptExtension(extension: string): boolean {
  return SCRIPT_EXTENSIONS.includes(normalizeExtension(extension));
}

/** What `run` accepts in this workspace: the configured list (else the default), never a script type. */
export function evidenceLimits(config: EvidenceConfig | undefined): {
  extensions: string[];
  maxBytes: number;
} {
  const listed = config?.extensions?.map(normalizeExtension) ?? EVIDENCE_EXTENSIONS;
  return {
    extensions: [...new Set(listed)].filter((e) => e !== "" && !isScriptExtension(e)),
    maxBytes: (config?.max_file_mb ?? EVIDENCE_MAX_FILE_MB) * 1024 * 1024,
  };
}

/** `image`, `video` or `file`, from an allowed extension. */
export function evidenceKind(extension: string): EvidenceKind {
  const ext = normalizeExtension(extension);
  if (IMAGES.has(ext)) return "image";
  if (VIDEOS.has(ext)) return "video";
  return "file";
}

/**
 * The stored form of an original base name: lower-case, every character
 * outside `[a-z0-9._-]` a `-`, at most 60 characters with the extension kept;
 * an empty stem becomes `file`.
 */
export function storedEvidenceName(original: string): string {
  const base = posix.basename(original.replaceAll("\\", "/"));
  const clean = base.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  const dot = clean.lastIndexOf(".");
  const extension = dot < 0 ? "" : clean.slice(dot);
  let stem = dot < 0 ? clean : clean.slice(0, dot);
  if (stem === "" || /^\.+$/.test(stem)) stem = "file";
  // An extension longer than the name allows is cut too: the name stays bounded.
  const kept = extension.slice(0, NAME_MAX - 1);
  return `${stem.slice(0, NAME_MAX - kept.length)}${kept}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `<project>/context/tests/.runs/<run>/<case>/<sha8>-<name>`, workspace-relative and POSIX. */
export function storedEvidencePath(
  projectPath: string,
  run: string,
  caseId: string,
  sha256: string,
  original: string,
): string {
  const name = `${sha256.slice(0, 8)}-${storedEvidenceName(original)}`;
  return posix.join(projectPath, TESTS_DIR, ".runs", run, caseId, name);
}

/**
 * Whether `ref` names a file stored inside a `.runs/<run-id>/` directory of
 * the project at `projectPath`: the files `validate` checks and the viewer
 * serves. A ref that leaves that directory (`..`, absolute, not normalized)
 * never counts.
 */
export function isStoredEvidenceRef(ref: string, projectPath: string): boolean {
  if (posix.isAbsolute(ref) || posix.normalize(ref) !== ref) return false;
  if (ref.split("/").includes("..")) return false;
  const runs = `${posix.join(projectPath, TESTS_DIR, ".runs")}/`;
  if (!ref.startsWith(runs)) return false;
  // `<run-id>/` then at least one more segment.
  const rest = ref.slice(runs.length).split("/");
  return rest.length >= 2 && rest.every((segment) => segment !== "" && segment !== ".");
}

/**
 * The run file whose events name a stored `ref`: `.runs/<run-id>/…` belongs to
 * `.runs/<run-id>.jsonl` of the same project. `null` when `ref` is not stored
 * under `projectPath` (`isStoredEvidenceRef`).
 */
export function evidenceRunFile(ref: string, projectPath: string): string | null {
  if (!isStoredEvidenceRef(ref, projectPath)) return null;
  const runs = posix.join(projectPath, TESTS_DIR, ".runs");
  const run = ref.slice(runs.length + 1).split("/")[0];
  return `${runs}/${run}.jsonl`;
}

/**
 * Whether `validate` checks an event's evidence entry: a file `run` stored
 * (`image`, `video`, `file`) inside a `.runs/<run-id>/` directory of the
 * project. Links and ingest's `attachment` references are not checked.
 */
export function isCheckedEvidence(
  entry: { kind: string; ref: string },
  projectPath: string,
): boolean {
  return EVIDENCE_FILE_KINDS.includes(entry.kind) && isStoredEvidenceRef(entry.ref, projectPath);
}

/** What `hashStoredEvidence` answers for a stored ref that is not a regular file. */
export const NOT_A_FILE = "not_a_file";

/** One entry of `run`'s input, before any file is read. */
export type EvidenceEntry =
  | { field: string; file: string; label?: string }
  | { field: string; url: string; label?: string };

/**
 * What the entries break before anything is read: too many, a link that is not
 * `http:`/`https:`, a file type the workspace does not allow.
 */
export function evidenceEntryProblems(
  entries: readonly EvidenceEntry[],
  extensions: readonly string[],
): CasefileError[] {
  const problems: CasefileError[] = [];
  const extra = entries[EVIDENCE_MAX_ENTRIES];
  if (extra !== undefined) {
    problems.push({
      code: "evidence.too_many",
      field: extra.field,
      message: `${entries.length} evidence entries: an event carries at most ${EVIDENCE_MAX_ENTRIES} files and links`,
    });
  }
  for (const entry of entries) {
    if ("url" in entry) {
      if (!isWebUrl(entry.url)) {
        problems.push({
          code: "evidence.link",
          field: entry.field,
          message: `'${entry.url}' is not an http: or https: URL`,
        });
      }
      continue;
    }
    const extension = extensionOf(entry.file);
    if (extensions.includes(extension) && !isScriptExtension(extension)) continue;
    problems.push({
      code: "evidence.type",
      field: entry.field,
      message: isScriptExtension(extension)
        ? `${entry.file}: .${extension} files are never attached, a browser would run them`
        : `${entry.file}: ${extension === "" ? "a file without an extension" : `.${extension}`} is not an allowed evidence type (${extensions.join(", ")}; set evidence.extensions in casefile.yaml)`,
    });
  }
  return problems;
}

function isWebUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
