import { posix } from "node:path";
import {
  CONFIG_FILE,
  normalizeProjectPath,
  POLICY_FILE,
  pathContains,
  TESTS_DIR,
} from "../load/paths.js";
import { CASEFILE_PACKAGE, TOOLCHAIN_DIR, type Toolchain } from "../operations/extensions.js";
import { NPM_INSTALL, notInstalled, TOOLCHAIN_PACKAGE } from "../operations/toolchain.js";
import { commonsChain, resolveCase, workspaceLayer } from "../resolve/resolve.js";
import { ExactVersion } from "../schema/index.js";
import { type Finding, finding, fromError } from "./finding.js";
import type { Level } from "./validate.js";

// The five levels of ADR agent-driven-setup, point 5, in order.

/** `casefile.yaml` and the projects it lists. */
export const workspaceLevel: Level = {
  name: "workspace",
  workspace({ workspace: { config, errors } }) {
    // Without a config the loader stopped: its errors are all about casefile.yaml.
    if (config === null) return errors.map(fromError);
    if (config.projects.length > 0) return [];
    return [
      finding("workspace.no_projects", {
        path: CONFIG_FILE,
        field: "projects",
        message: "casefile.yaml lists no projects; a workspace needs at least one",
      }),
    ];
  },
  project({ index, entry, loaded }, { workspace: { config, errors } }) {
    const field = `projects.${index}`;
    const found = errors
      .filter((e) => e.path === CONFIG_FILE && e.field?.startsWith(`${field}.`))
      .map(fromError);
    const path = normalizeProjectPath(entry.path);
    const earlier = (config?.projects ?? []).slice(0, index);
    const sameName = earlier.find((p) => p.name === entry.name);
    if (sameName !== undefined) {
      found.push(
        finding("project.duplicate_name", {
          path: CONFIG_FILE,
          field: `${field}.name`,
          message: `project name '${entry.name}' is already used by projects.${earlier.indexOf(sameName)}`,
        }),
      );
    }
    const samePath = earlier.find((p) => normalizeProjectPath(p.path) === path);
    if (samePath !== undefined) {
      found.push(
        finding("project.duplicate_path", {
          path: CONFIG_FILE,
          field: `${field}.path`,
          message: `${entry.path} is the directory of project '${samePath.name}' (${samePath.path})`,
        }),
      );
    }
    const nesting = earlier.find((p) => {
      const other = normalizeProjectPath(p.path);
      return other !== path && (pathContains(other, path) || pathContains(path, other));
    });
    if (nesting !== undefined) {
      found.push(
        finding("project.nested", {
          path: CONFIG_FILE,
          field: `${field}.path`,
          message: `project '${entry.name}' at ${path} and project '${nesting.name}' at ${normalizeProjectPath(nesting.path)} nest`,
        }),
      );
    }
    if (loaded !== undefined && !loaded.hasTestsDir) {
      found.push(
        finding("project.tests_missing", {
          path: CONFIG_FILE,
          field: `${field}.path`,
          message: `project '${entry.name}' has no ${posix.join(path, TESTS_DIR)}/ directory`,
        }),
      );
    }
    return found;
  },
};

/** Every file the loader read in a project parses and matches its schema. */
export const schemaLevel: Level = {
  name: "schema",
  project({ loaded }, { workspace: { errors } }) {
    if (loaded === undefined) return [];
    const prefix = `${posix.join(loaded.path, TESTS_DIR)}/`;
    const policy = posix.join(loaded.path, POLICY_FILE);
    return errors
      .filter((e) => e.path !== undefined && (e.path.startsWith(prefix) || e.path === policy))
      .map(fromError);
  },
};

/**
 * Rules across the files of one project: each case's `feature` mirrors its
 * folder, ids are unique, label keys are declared in `_properties.yaml`, and
 * each run event names a case of the project.
 */
export const crossFileLevel: Level = {
  name: "cross-file",
  project({ loaded }, { workspace: { config } }) {
    if (loaded === undefined) return [];
    const found: Finding[] = [];
    const testsDir = posix.join(loaded.path, TESTS_DIR);
    const cases = [...loaded.cases].sort((a, b) => (a.path < b.path ? -1 : 1));

    const firstWithId = new Map<string, string>();
    for (const { path, file } of cases) {
      const folder = posix.dirname(path.slice(testsDir.length + 1));
      if (file.feature !== folder) {
        found.push(
          finding("case.feature_mismatch", {
            path,
            field: "feature",
            message:
              folder === "."
                ? `case is at the root of ${testsDir}/; cases live in a feature folder`
                : `feature '${file.feature}' does not mirror the case's folder '${folder}'`,
            expected: folder === "." ? "a feature folder" : folder,
          }),
        );
      }
      const first = firstWithId.get(file.id);
      if (first === undefined) firstWithId.set(file.id, path);
      else {
        found.push(
          finding("case.duplicate_id", {
            path,
            field: "id",
            message: `${file.id} is also the id of ${first}`,
          }),
        );
      }
    }

    const declared = loaded.properties?.properties ?? {};
    const propertiesPath = `${testsDir}/_properties.yaml`;
    const labelled: { path: string; prefix: string; labels: Record<string, unknown> }[] = [
      { path: CONFIG_FILE, prefix: "commons.labels", labels: config?.commons?.labels ?? {} },
      ...[...loaded.commons].map(([path, commons]) => ({
        path,
        prefix: "labels",
        labels: commons.labels ?? {},
      })),
      ...cases.map(({ path, file }) => ({ path, prefix: "labels", labels: file.labels ?? {} })),
    ];
    for (const { path, prefix, labels } of labelled) {
      for (const key of Object.keys(labels)) {
        if (Object.hasOwn(declared, key)) continue;
        found.push(
          finding("label.undeclared", {
            path,
            field: `${prefix}.${key}`,
            message: `label '${key}' is not declared in ${propertiesPath} (project '${loaded.name}')`,
            hint: `declare \`${key}\` under \`properties:\` in ${propertiesPath}`,
          }),
        );
      }
    }

    for (const { path, line, event } of loaded.runs) {
      if (firstWithId.has(event.case_id)) continue;
      found.push(
        finding("run.unknown_case", {
          path,
          line,
          field: "case_id",
          message: `run '${event.run_id}' records ${event.case_id}, which is not a case of project '${loaded.name}'`,
        }),
      );
    }
    return found;
  },
};

/** Every case has its required fields once commons are inherited. */
export const resolutionLevel: Level = {
  name: "resolution",
  project({ loaded }, { workspace: { config }, extensionLayers = [] }) {
    if (loaded === undefined) return [];
    const outer = [...extensionLayers, ...workspaceLayer(config)];
    return loaded.cases.flatMap((c) => {
      const result = resolveCase(c, {
        project: loaded.name,
        layers: [...outer, ...commonsChain(loaded.commons, loaded.path, c.path)],
        runs: [],
        commitFor: () => null,
      });
      return result.ok ? [] : result.errors.map(fromError);
    });
  },
};

/**
 * What must be installed for the workspace to run (ADR casefile-toolchain-dir):
 * every listed extension, and casefile when `.casefile/package.json` declares it,
 * at their exact pins when they have one. Without that file only extensions are
 * checked: nothing else is declared.
 */
export const environmentLevel: Level = {
  name: "environment",
  workspace({ workspace: { config }, toolchain }) {
    const found: Finding[] = [];
    for (const [index, name] of (config?.extensions ?? []).entries()) {
      const message = notInstalled(toolchain, name);
      if (message === null) continue;
      found.push(
        finding("extension.not_installed", {
          path: CONFIG_FILE,
          field: `extensions.${index}`,
          message,
          hint: `${NPM_INSTALL} --save-exact ${name}`,
        }),
      );
    }
    if (toolchain.declared === null) return found;
    const pin = toolchain.declared[CASEFILE_PACKAGE];
    const at = { path: TOOLCHAIN_PACKAGE, field: `dependencies.${CASEFILE_PACKAGE}` };
    if (pin === undefined || !ExactVersion.safeParse(pin).success) {
      found.push(
        finding("toolchain.unpinned", {
          ...at,
          message:
            pin === undefined
              ? `${TOOLCHAIN_PACKAGE} does not declare ${CASEFILE_PACKAGE}`
              : `${TOOLCHAIN_PACKAGE} declares ${CASEFILE_PACKAGE} as '${pin}', not an exact version`,
          expected: "an exact version, e.g. 0.4.1",
        }),
      );
    }
    const message = pin === undefined ? null : notInstalled(toolchain, CASEFILE_PACKAGE);
    if (message !== null) found.push(finding("toolchain.not_installed", { ...at, message }));
    return found;
  },
};
