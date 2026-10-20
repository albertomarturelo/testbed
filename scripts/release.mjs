#!/usr/bin/env node
// ADR 2026-10-20-release-process: @casefile/core and @casefile/cli share one
// version. `set` writes it into both package.json files and into the pins of
// the examples' toolchains (scripts/link-toolchain.mjs needs pin = source);
// `check` makes the release workflow refuse a tag that does not match them.
// Usage: node scripts/release.mjs set <x.y.z>
//        node scripts/release.mjs check <v<x.y.z>>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const PACKAGES = ["packages/core/package.json", "apps/cli/package.json"];
const SEMVER = /^\d+\.\d+\.\d+$/;
const [command, value] = process.argv.slice(2);

if (command === "set" && SEMVER.test(value ?? "")) {
  for (const path of PACKAGES) update(path, (pkg) => (pkg.version = value));
  for (const example of readdirSync(join(root, "examples"))) {
    const path = join("examples", example, ".casefile/package.json");
    if (!existsSync(join(root, path))) continue;
    update(path, (pkg) => (pkg.dependencies["@casefile/cli"] = value));
  }
  console.log(
    `version ${value}: commit it as chore(release): v${value}, then tag v${value} on main`,
  );
} else if (command === "check" && /^v\d+\.\d+\.\d+$/.test(value ?? "")) {
  const wrong = PACKAGES.filter((path) => read(path).version !== value.slice(1));
  if (wrong.length > 0) {
    console.error(
      `${value} does not match the version of ${wrong.join(", ")}: run release.mjs set first`,
    );
    process.exit(1);
  }
  console.log(`${value} matches ${PACKAGES.join(", ")}`);
} else {
  console.error("usage: node scripts/release.mjs set <x.y.z> | check v<x.y.z>");
  process.exit(1);
}

function read(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

/** Rewrites a package.json, keeping its key order and two-space indent. */
function update(path, change) {
  const pkg = read(path);
  change(pkg);
  writeFileSync(join(root, path), `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`updated ${path}`);
}
