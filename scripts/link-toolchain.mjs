#!/usr/bin/env node
// ADR 2026-10-17-npm-scope-casefile §6: until @casefile/cli is published, a
// workspace inside this repository links its toolchain to the source. Symlinks
// <workspace>/.casefile/node_modules/@casefile/cli to apps/cli (and .bin/casefile
// to its bin); that path is
// gitignored by .casefile/.gitignore, so nothing linked is committed.
// Usage: node scripts/link-toolchain.mjs <workspace dir>   (run `pnpm build` first)
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const cli = join(root, "apps/cli");
const target = process.argv[2];
if (target === undefined) {
  console.error("usage: node scripts/link-toolchain.mjs <workspace dir>");
  process.exit(1);
}
const workspace = resolve(target);
if (!existsSync(join(workspace, "casefile.yaml"))) {
  console.error(`${workspace} has no casefile.yaml: run casefile init there first`);
  process.exit(1);
}
const pin = JSON.parse(readFileSync(join(workspace, ".casefile/package.json"), "utf8"));
const version = JSON.parse(readFileSync(join(cli, "package.json"), "utf8")).version;
if (pin.dependencies?.["@casefile/cli"] !== version) {
  console.error(`.casefile/package.json must pin @casefile/cli ${version} (the source version)`);
  process.exit(1);
}
const link = join(workspace, ".casefile/node_modules/@casefile/cli");
mkdirSync(dirname(link), { recursive: true });
if (existsSync(link) || isSymlink(link)) rmSync(link, { recursive: true, force: true });
symlinkSync(relative(dirname(link), cli), link, "dir");
// As npm would: .bin/casefile, the path skills and CI run.
const bin = join(workspace, ".casefile/node_modules/.bin/casefile");
mkdirSync(dirname(bin), { recursive: true });
if (existsSync(bin) || isSymlink(bin)) rmSync(bin, { force: true });
symlinkSync("../@casefile/cli/dist/bin.js", bin);
// tsc does not set the executable bit; npm would on install.
chmodSync(join(cli, "dist/bin.js"), 0o755);
console.log(`linked ${link} -> ${cli}`);

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
