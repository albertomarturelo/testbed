#!/usr/bin/env node
// ADR 2026-11-09-release-toolchain-tarball: the release also ships the
// `node_modules/` npm would install, for networks without the npm registry.
// Installs the packed @casefile/core and @casefile/cli tarballs of <pack dir>
// in an empty directory and archives the result as
// <out dir>/casefile-toolchain-<version>.tgz, with its `.sha256` beside it.
// Unpack into a workspace's `.casefile/`.
// Usage: node scripts/toolchain-tarball.mjs <pack dir> <out dir>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [packArg, outArg] = process.argv.slice(2);
if (packArg === undefined || outArg === undefined) {
  console.error("usage: node scripts/toolchain-tarball.mjs <pack dir> <out dir>");
  process.exit(1);
}
const packDir = resolve(packArg);
const outDir = resolve(outArg);
const packed = readdirSync(packDir)
  .filter((name) => /^casefile-(core|cli)-\d+\.\d+\.\d+\.tgz$/.test(name))
  .map((name) => join(packDir, name));
if (packed.length !== 2) {
  console.error(`${packDir} must hold the packed core and cli tarballs (found ${packed.length})`);
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), "casefile-toolchain-"));
try {
  writeFileSync(join(stage, "package.json"), '{ "private": true }\n');
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      ...packed,
    ],
    { cwd: stage, stdio: "inherit" },
  );
  // npm's own bookkeeping: it records the local paths of this machine.
  rmSync(join(stage, "node_modules/.package-lock.json"), { force: true });

  const version = JSON.parse(
    readFileSync(join(stage, "node_modules/@casefile/cli/package.json"), "utf8"),
  ).version;
  const name = `casefile-toolchain-${version}.tgz`;
  mkdirSync(outDir, { recursive: true });
  execFileSync("tar", ["-czf", join(outDir, name), "-C", stage, "node_modules"], {
    stdio: "inherit",
  });
  const digest = createHash("sha256")
    .update(readFileSync(join(outDir, name)))
    .digest("hex");
  // The line `shasum -a 256 -c` and `sha256sum -c` read.
  writeFileSync(join(outDir, `${name}.sha256`), `${digest}  ${name}\n`);
  console.log(`${join(outDir, name)}\n${digest}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
