#!/usr/bin/env node
// Enforces ADR 2026-10-15-apps-vs-packages: an app never depends on or imports another app.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const appsDir = join(root, "apps");

const apps = readdirSync(appsDir)
  .filter((name) => statSync(join(appsDir, name)).isDirectory())
  .map((name) => {
    const dir = join(appsDir, name);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { name, dir, pkg };
  });

const appPackageNames = new Set(apps.map((app) => app.pkg.name));
const violations = [];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) yield path;
  }
}

const SPECIFIER = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

for (const app of apps) {
  const deps = {
    ...app.pkg.dependencies,
    ...app.pkg.devDependencies,
    ...app.pkg.peerDependencies,
  };
  for (const dep of Object.keys(deps)) {
    if (appPackageNames.has(dep) && dep !== app.pkg.name) {
      violations.push(`apps/${app.name}/package.json depends on app '${dep}'`);
    }
  }

  const srcDir = join(app.dir, "src");
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(SPECIFIER)) {
      const bare = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0];
      const crossesByName = appPackageNames.has(bare) && bare !== app.pkg.name;
      const target = spec.startsWith(".") ? resolve(dirname(file), spec) : null;
      const crossesByPath = target?.startsWith(appsDir + sep) && !target.startsWith(app.dir + sep);
      if (crossesByName || crossesByPath) {
        violations.push(`${relative(root, file)} imports '${spec}' from another app`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("App boundary violations (see ADR 2026-10-15-apps-vs-packages):");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`App boundaries OK (${apps.length} apps checked).`);
