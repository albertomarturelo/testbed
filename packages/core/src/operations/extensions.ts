import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { type CasefileError, ok, type Result } from "../errors.js";
import { CONFIG_FILE } from "../load/paths.js";
import { type CommonsLayer, extensionLayer } from "../resolve/resolve.js";
import { CommonFile, PackageName } from "../schema/index.js";
import type { Operation } from "./operation.js";
import type { Registry } from "./registry.js";

/** Where casefile and its extensions are installed (ADR casefile-toolchain-dir). */
export const TOOLCHAIN_DIR = ".casefile";

/**
 * What an extension package exports as `manifest` (ADR extension-model). Only
 * the parts with a consumer today are typed; ingesters, bridges, validators and
 * skills join when their extension points land.
 */
export type ExtensionManifest = {
  operations?: Operation[];
  /** Org-level commons (ADR org-commons-via-extension). */
  commons?: CommonFile;
};

export type LoadedExtension = {
  name: string;
  /** The installed version, from its `package.json` in `.casefile/node_modules`. */
  version: string;
  manifest: ExtensionManifest;
};

/**
 * Filesystem adapter: imports each extension listed in `casefile.yaml` from
 * `.casefile/node_modules` only — a copy elsewhere (e.g. the product's root
 * `node_modules`) never counts, so the product's dependencies cannot change what
 * casefile loads. Order follows `names`; failures are error values.
 */
export async function loadExtensions(
  root: string,
  names: readonly string[],
): Promise<{ extensions: LoadedExtension[]; errors: CasefileError[] }> {
  const extensions: LoadedExtension[] = [];
  const errors: CasefileError[] = [];
  for (const [index, name] of names.entries()) {
    const at = { path: CONFIG_FILE, field: `extensions.${index}` };
    if (!PackageName.safeParse(name).success) {
      errors.push({
        code: "extension.invalid_name",
        ...at,
        message: `${name} is not an npm package name`,
      });
      continue;
    }
    const dir = join(root, TOOLCHAIN_DIR, "node_modules", name);
    const pkg = await readPackageJson(join(dir, "package.json"));
    if (pkg === null) {
      errors.push({
        code: "extension.not_installed",
        ...at,
        message: `${name} is not installed in ${TOOLCHAIN_DIR}/node_modules`,
      });
      continue;
    }
    const entry = entryPoint(pkg);
    if (entry === null) {
      errors.push({
        code: "extension.load_failed",
        ...at,
        message: `${name} declares an entry point outside its package`,
      });
      continue;
    }
    let module: Record<string, unknown>;
    try {
      module = await import(pathToFileURL(join(dir, entry)).href);
    } catch (error) {
      errors.push({
        code: "extension.load_failed",
        ...at,
        message: `${name} could not be imported: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const manifest = checkManifest(name, module.manifest);
    if (!manifest.ok) {
      errors.push(...manifest.errors.map((e) => ({ ...e, ...at })));
      continue;
    }
    const version = typeof pkg.version === "string" ? pkg.version : "0.0.0";
    extensions.push({ name, version, manifest: manifest.value });
  }
  return { extensions, errors };
}

/** Registers every extension operation through the public registry API. */
export function registerExtensions(
  registry: Registry,
  extensions: readonly LoadedExtension[],
): CasefileError[] {
  return extensions.flatMap(({ name, manifest }) =>
    (manifest.operations ?? []).flatMap((operation) => {
      const result = registry.register(operation);
      return result.ok
        ? []
        : result.errors.map((e) => ({ ...e, message: `${name}: ${e.message}` }));
    }),
  );
}

/** The commons layers extensions contribute, in `casefile.yaml` order. */
export function extensionLayers(extensions: readonly LoadedExtension[]): CommonsLayer[] {
  return extensions.flatMap(({ name, version, manifest }) =>
    manifest.commons === undefined ? [] : [extensionLayer(name, version, manifest.commons)],
  );
}

type PackageJson = { version?: unknown; main?: unknown; exports?: unknown };

async function readPackageJson(file: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * The ESM entry for `import(pkg)`: `exports["."]` (import/default conditions),
 * `main`, or `index.js`; `null` when it points outside the package.
 */
function entryPoint(pkg: PackageJson): string | null {
  const pick = (target: unknown): string | undefined => {
    if (typeof target === "string") return target;
    if (target === null || typeof target !== "object") return undefined;
    const conditions = target as Record<string, unknown>;
    if ("." in conditions) return pick(conditions["."]);
    return pick(conditions.import) ?? pick(conditions.default);
  };
  const entry = pick(pkg.exports) ?? (typeof pkg.main === "string" ? pkg.main : "index.js");
  const normalized = posix.normalize(entry);
  return normalized.startsWith("../") || posix.isAbsolute(normalized) ? null : normalized;
}

function checkManifest(name: string, value: unknown): Result<ExtensionManifest> {
  const invalid = (message: string): Result<ExtensionManifest> => ({
    ok: false,
    errors: [{ code: "extension.invalid_manifest", message: `${name}: ${message}` }],
  });
  if (value === null || typeof value !== "object") return invalid("exports no `manifest` object");
  const { operations, commons } = value as Record<string, unknown>;
  if (operations !== undefined && !Array.isArray(operations)) {
    return invalid("`manifest.operations` is not an array");
  }
  let parsedCommons: CommonFile | undefined;
  if (commons !== undefined) {
    const parsed = CommonFile.safeParse(commons);
    if (!parsed.success) {
      return invalid(`\`manifest.commons\` is not a valid _common.yaml: ${parsed.error.message}`);
    }
    parsedCommons = parsed.data;
  }
  return ok({
    ...(operations === undefined ? {} : { operations: operations as Operation[] }),
    ...(parsedCommons === undefined ? {} : { commons: parsedCommons }),
  });
}
