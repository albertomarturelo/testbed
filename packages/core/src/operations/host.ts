import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CasefileError } from "../errors.js";
import { parseConfigFile } from "../load/parse.js";
import { CONFIG_FILE } from "../load/paths.js";
import type { Config } from "../schema/index.js";
import { builtinOperations } from "./builtins.js";
import { loadExtensions, registerExtensions, TOOLCHAIN_DIR } from "./extensions.js";
import { createRegistry, type Registry } from "./registry.js";
import { CORE_PACKAGE_DIR, type SpecIndex, specFile } from "./spec.js";

/** What a host needs to render and run operations (ADR cli-generic-host). */
export type HostRegistry = {
  registry: Registry;
  /** SPEC file of every registered operation, for `casefile spec` and help summaries. */
  specs: SpecIndex;
  /** `casefile.yaml`, or `null` without a workspace or when it does not parse. */
  config: Config | null;
  /** Why the config or an extension could not be loaded; `validate` reports the same. */
  errors: CasefileError[];
};

/**
 * Filesystem adapter: core's operations plus, inside a workspace, the
 * extensions `casefile.yaml` lists, loaded from `.casefile/node_modules`
 * (ADR casefile-toolchain-dir). `root: null` means no workspace: built-ins only.
 */
export async function openRegistry(root: string | null): Promise<HostRegistry> {
  const registry = createRegistry();
  const specs: SpecIndex = new Map();
  const errors: CasefileError[] = [];
  const add = (packageDir: string, operations: readonly HostOperation[]) => {
    for (const operation of operations) {
      const file = specFile(packageDir, operation);
      if (file !== null) specs.set(operation.name, file);
    }
  };

  for (const operation of builtinOperations) registry.register(operation);
  add(CORE_PACKAGE_DIR, builtinOperations);
  if (root === null) return { registry, specs, config: null, errors };

  const text = await readFile(join(root, CONFIG_FILE), "utf8").catch(() => null);
  const parsed = text === null ? null : parseConfigFile(CONFIG_FILE, text);
  if (parsed !== null && !parsed.ok) errors.push(...parsed.errors);
  const config = parsed?.ok ? parsed.value : null;

  const loaded = await loadExtensions(root, config?.extensions ?? []);
  errors.push(...loaded.errors, ...registerExtensions(registry, loaded.extensions));
  for (const extension of loaded.extensions) {
    const dir = join(root, TOOLCHAIN_DIR, "node_modules", extension.name);
    // Only the operations that registered: a clashing name keeps the first one's SPEC.
    add(
      dir,
      (extension.manifest.operations ?? []).filter((op) => registry.get(op.name) === op),
    );
  }
  return { registry, specs, config, errors };
}

type HostOperation = { name: string; spec: string };
