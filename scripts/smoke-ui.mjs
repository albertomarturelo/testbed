#!/usr/bin/env node
// ADR 2026-11-09-casefile-ui-command §8: proves an installed toolchain opens
// the viewer. Starts `<casefile bin> ui --port 0` in <workspace>, fetches the
// page and one API call, stops casefile with SIGTERM and checks the server
// stopped with it.
// Usage: node scripts/smoke-ui.mjs <casefile bin> <workspace dir>
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const [binArg, workspaceArg] = process.argv.slice(2);
if (binArg === undefined || workspaceArg === undefined) {
  console.error("usage: node scripts/smoke-ui.mjs <casefile bin> <workspace dir>");
  process.exit(1);
}

const child = spawn(process.execPath, [resolve(binArg), "ui", "--port", "0"], {
  cwd: resolve(workspaceArg),
  stdio: ["ignore", "pipe", "inherit"],
});
const exited = new Promise((done) => child.on("exit", (code, signal) => done({ code, signal })));
const timeout = setTimeout(() => {
  console.error("casefile ui did not print its address in 15 s");
  child.kill("SIGKILL");
  process.exit(1);
}, 15_000);

let printed = "";
let serving = false;
const url = await new Promise((found) => {
  child.stdout.on("data", (chunk) => {
    printed += chunk;
    const match = /http:\/\/127\.0\.0\.1:\d+/.exec(printed);
    if (match) {
      serving = true;
      found(match[0]);
    }
  });
  exited.then(({ code }) => {
    if (serving) return;
    console.error(`casefile ui exited with ${code} before serving:\n${printed}`);
    process.exit(1);
  });
});
clearTimeout(timeout);

try {
  const page = await fetch(url);
  const html = await page.text();
  if (!page.ok || !html.includes('<div id="root"'))
    throw new Error(`GET / answered ${page.status}`);
  const session = await fetch(`${url}/api/session`);
  const body = await session.json();
  if (!session.ok || body.ok !== true)
    throw new Error(`GET /api/session answered ${session.status}`);
} catch (error) {
  console.error(`viewer check failed: ${error instanceof Error ? error.message : error}`);
  child.kill("SIGKILL");
  process.exit(1);
}

// Stopping casefile stops the server it started.
child.kill("SIGTERM");
await exited;
const still = await fetch(url).then(
  () => true,
  () => false,
);
if (still) {
  console.error(`the viewer still answers on ${url} after casefile stopped`);
  process.exit(1);
}
console.log(`casefile ui served ${url} and stopped`);
