import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, ok, type Result } from "../errors.js";
import { Slug } from "../schema/index.js";
import type { Operation } from "./operation.js";

/** Root of the `@casefile/core` package (the same from `src/` and `dist/`). */
export const CORE_PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** Topic SPECs and core's own operation SPECs (ADR specs-ship-with-operations). */
export const CORE_SPECS_DIR = join(CORE_PACKAGE_DIR, "specs");

/** Operation name → absolute path of its SPEC, built by the host as it registers operations. */
export type SpecIndex = Map<string, string>;

/**
 * Where an operation's SPEC is: its `spec` resolved against the package that
 * declares it. `null` when the path leaves that package.
 */
export function specFile(packageDir: string, operation: Pick<Operation, "spec">): string | null {
  const file = resolve(packageDir, operation.spec);
  const rel = relative(resolve(packageDir), file);
  return rel === "" || rel.startsWith(`..${sep}`) || rel === ".." ? null : file;
}

/**
 * The SPEC text of a registered operation, else of a core topic
 * (`specs/<name>.md`). Unknown names are `spec.unknown`.
 */
export async function readSpec(specs: SpecIndex, name: string): Promise<Result<string>> {
  const file =
    specs.get(name) ?? (Slug.safeParse(name).success ? join(CORE_SPECS_DIR, `${name}.md`) : null);
  const text = file === null ? null : await readFile(file, "utf8").catch(() => null);
  if (text === null) {
    return fail({
      code: "spec.unknown",
      message: `no operation or topic SPEC named '${name}'`,
    });
  }
  return ok(text);
}

/** The first paragraph after the title: what the operation does, for help listings. */
export function specSummary(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line, i) => i > 0 && line.trim() !== "" && !line.startsWith("#"));
  if (start === -1) return "";
  const end = lines.findIndex((line, i) => i > start && line.trim() === "");
  return lines
    .slice(start, end === -1 ? undefined : end)
    .map((line) => line.trim())
    .join(" ");
}
