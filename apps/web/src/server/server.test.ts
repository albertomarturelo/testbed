import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
} from "../../../../packages/core/src/demo.fixture.js";
import { createUiServer } from "./server.js";

let server: Server;
let base = "";
let clientDir = "";

beforeAll(async () => {
  clientDir = await mkdtemp(join(tmpdir(), "casefile-web-"));
  await mkdir(join(clientDir, "assets"));
  await writeFile(join(clientDir, "index.html"), "<!doctype html><title>casefile</title>");
  await writeFile(join(clientDir, "assets", "app.js"), "console.log(1)");
  server = createUiServer({ root: DEMO_MONOREPO_ROOT, clientDir });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  await rm(clientDir, { recursive: true, force: true });
});

const call = async (name: string, input: unknown = {}) => {
  const response = await fetch(`${base}/api/operations/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  // biome-ignore lint/suspicious/noExplicitAny: assertions narrow the JSON Result
  return { status: response.status, body: (await response.json()) as any };
};

describe("API", () => {
  it("runs overview over the workspace and answers its Result", async () => {
    const { status, body } = await call("overview");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const projects = Object.fromEntries(
      body.value.projects.map((p: { name: string; path: string }) => [p.name, p.path]),
    );
    expect(projects).toEqual(DEMO_MONOREPO_EXPECTED.projects);
    const refs = body.value.cases.map((c: { ref: string }) => c.ref).sort();
    expect(refs).toEqual([...DEMO_MONOREPO_EXPECTED.caseRefs]);
  });

  it("passes the project the UI selects, like --project", async () => {
    const { body } = await call("query", { query: "state = active", project: "api" });
    expect(body).toMatchObject({ ok: true, value: { cases: [{ ref: "api/TC-0001" }] } });
  });

  it("answers resolve and validate like `--json`", async () => {
    const resolved = await call("resolve", { ref: "web/TC-0001" });
    expect(resolved.body).toMatchObject({ ok: true, value: { ref: "web/TC-0001" } });
    const commons = resolved.body.value.inherited.map((row: { origin: string }) => row.origin);
    for (const file of DEMO_MONOREPO_EXPECTED.webTc0001CommonsChain) {
      expect(commons).toContain(file);
    }
    const validated = await call("validate");
    expect(validated.body.ok).toBe(true);
  });

  it("returns operation errors as a Result with status 200", async () => {
    const { status, body } = await call("query", { query: "state =" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, errors: [{ field: "query" }] });
  });

  it("refuses operations that write, unknown operations and bad bodies", async () => {
    expect(await call("init")).toMatchObject({
      status: 403,
      body: { ok: false, errors: [{ code: "ui.read_only" }] },
    });
    expect(await call("nope")).toMatchObject({
      status: 404,
      body: { errors: [{ code: "ui.unknown_operation" }] },
    });
    expect(await call("overview", [1])).toMatchObject({
      status: 400,
      body: { errors: [{ code: "ui.invalid_input" }] },
    });
    const get = await fetch(`${base}/api/operations/overview`);
    expect(get.status).toBe(404);
  });

  it("refuses a request that names another host", async () => {
    // fetch() does not let a caller set Host, a rebinding page's browser does.
    const status = await new Promise<number | undefined>((done, failed) => {
      const port = (server.address() as AddressInfo).port;
      request({ port, host: "127.0.0.1", path: "/", headers: { host: `evil.example:${port}` } })
        .on("response", (response) => {
          response.resume();
          done(response.statusCode);
        })
        .on("error", failed)
        .end();
    });
    expect(status).toBe(403);
  });
});

describe("static files", () => {
  it("serves assets, and the app for any other path", async () => {
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(await asset.text()).toBe("console.log(1)");
    for (const path of ["/", "/anything", "/assets/missing.js"]) {
      const page = await fetch(`${base}${path}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<title>casefile</title>");
    }
  });

  it("never serves a file outside the client directory", async () => {
    for (const path of ["/..%2f..%2fpackage.json", "/%E0%A4%A"]) {
      const page = await fetch(`${base}${path}`);
      expect(await page.text()).toContain("<title>casefile</title>");
    }
  });
});
