#!/usr/bin/env node
// ADR 2026-11-21-readme-screenshots: regenerates the README's screenshots of the
// viewer. Starts the built viewer on examples/demo-repo at a free port, opens each
// view in headless Chromium with fixed inputs (1280×800, light, reduced motion, a
// fictitious identity), waits for it to render and writes docs/screenshots/<name>.png.
// Usage, after `pnpm build`: pnpm screenshots
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "apps/web/dist/server/bin.js");
const workspace = join(root, "examples/demo-repo");
const out = join(root, "docs/screenshots");
// The browser comes from examples/npm-login, as for every viewer check (CONVENTIONS 14).
const playwrightEntry = join(root, "examples/npm-login/node_modules/playwright/index.mjs");

if (!existsSync(server)) fail("the viewer is not built: run `pnpm build` first");
if (!existsSync(playwrightEntry)) {
  fail(
    "Playwright is not installed: run `npm ci && npx playwright install chromium` in examples/npm-login",
  );
}
const { chromium } = await import(pathToFileURL(playwrightEntry).href);

/**
 * Each screenshot: the route it opens, what proves the view rendered, and an
 * optional step before the picture (a query to run).
 */
const SHOTS = [
  {
    name: "dashboard",
    hash: "#/dashboard/web/overview",
    ready: (page) => page.locator(".recharts-surface").first().waitFor(),
  },
  {
    name: "cases",
    hash: "#/cases",
    ready: (page) => page.getByRole("link", { name: "Sign in with valid credentials" }).waitFor(),
  },
  {
    name: "case",
    hash: "#/case/web/TC-0002",
    ready: (page) => page.getByRole("dialog").getByText("web/TC-0002").first().waitFor(),
  },
  {
    name: "query",
    hash: "#/query",
    ready: async (page) => {
      await page.getByLabel("Query").fill("priority <= P1 AND state = active");
      await page.getByRole("button", { name: /Run/ }).click();
      // A query that matches nothing would show an empty page.
      await page.getByText(/^[1-9]\d* cases?$/).waitFor();
    },
  },
  {
    name: "milestone",
    hash: "#/milestone/web/web-1.2.0",
    ready: (page) => page.getByRole("heading", { name: "Web 1.2.0" }).waitFor(),
  },
];

const child = spawn(process.execPath, [server, "--port", "0"], {
  cwd: workspace,
  // Never the git identity of whoever runs it: it would end up in the README.
  env: { ...process.env, CASEFILE_USER_EMAIL: "qa@acme.example", CASEFILE_USER_NAME: "QA Lead" },
  stdio: ["ignore", "pipe", "inherit"],
});
const url = await new Promise((found) => {
  let printed = "";
  const timeout = setTimeout(() => stop("the viewer did not print its address in 15 s"), 15_000);
  child.stdout.on("data", (chunk) => {
    printed += chunk;
    const match = /http:\/\/127\.0\.0\.1:\d+/.exec(printed);
    if (match) {
      clearTimeout(timeout);
      found(match[0]);
    }
  });
  child.on("exit", (code) => stop(`the viewer exited with ${code} before serving:\n${printed}`));
});

const browser = await chromium.launch();
let failure;
try {
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  for (const shot of SHOTS) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/${shot.hash}`);
    await shot.ready(page).catch((error) => {
      throw new Error(`${shot.name}: the view did not render (${error.message.split("\n")[0]})`);
    });
    await page.waitForLoadState("networkidle");
    // Charts and Sheets animate in; reduced motion shortens it, this settles it.
    await page.waitForTimeout(800);
    if (errors.length > 0) throw new Error(`${shot.name}: page error: ${errors.join("; ")}`);
    await page.screenshot({ path: join(out, `${shot.name}.png`) });
    console.log(`docs/screenshots/${shot.name}.png`);
    await page.close();
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  // Close the browser and the server before reporting, so neither outlives the script.
  await browser.close();
  child.removeAllListeners("exit");
  child.kill("SIGTERM");
}
if (failure !== undefined) fail(failure);

function stop(message) {
  child.kill("SIGKILL");
  fail(message);
}

function fail(message) {
  console.error(`screenshots: ${message}`);
  process.exit(1);
}
