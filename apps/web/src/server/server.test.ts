import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Identity } from "@casefile/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  NPM_LOGIN_EXPECTED,
  NPM_LOGIN_ROOT,
} from "../../../../packages/core/src/demo.fixture.js";
import { createUiServer, TOKEN_HEADER } from "./server.js";

let server: Server;
let base = "";
let clientDir = "";

beforeAll(async () => {
  clientDir = await mkdtemp(join(tmpdir(), "casefile-web-"));
  await mkdir(join(clientDir, "assets"));
  await writeFile(join(clientDir, "index.html"), "<!doctype html><title>casefile</title>");
  await writeFile(join(clientDir, "assets", "app.js"), "console.log(1)");
  server = createUiServer({ root: DEMO_MONOREPO_ROOT, clientDir, identity: null });
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

  it("refuses a write from outside the page, unknown operations and bad bodies", async () => {
    expect(await call("run", { ref: "web/TC-0001", status: "passed" })).toMatchObject({
      status: 403,
      body: { ok: false, errors: [{ code: "ui.forbidden" }] },
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

describe("writes (ADR human-writes-through-operations §2–3)", () => {
  /** No global or system git config: only the temp repository's own counts. */
  const isolated = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const RUN_FILE = "apps/web/context/tests/.runs";
  const CASE_FILE = "apps/web/context/tests/login/TC-0001.md";
  const git = (root: string, ...args: string[]) =>
    execFileSync("git", args, { cwd: root, env: isolated, encoding: "utf8" }).trimEnd();

  let root = "";
  let writer: Server | null = null;
  let origin = "";
  let token = "";

  /** A copy of the demo monorepo as a git repository of its own, with one commit. */
  async function repository(init = true) {
    root = await mkdtemp(join(tmpdir(), "casefile-web-write-"));
    await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
    if (!init) return;
    git(root, "init", "-q");
    git(root, "config", "user.name", "Dev");
    git(root, "config", "user.email", "dev@acme.example");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
  }

  async function start(identity: Identity | null) {
    writer = createUiServer({ root, clientDir, identity, env: isolated });
    const listening = writer;
    await new Promise<void>((done) => listening.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
    const session = (await (await fetch(`${origin}/api/session`)).json()) as {
      ok: boolean;
      value: { token: string; identity: unknown };
    };
    token = session.value.token;
    return session;
  }

  afterEach(async () => {
    if (writer !== null) await new Promise((done) => writer?.close(done));
    writer = null;
    await rm(root, { recursive: true, force: true });
  });

  const write = async (name: string, input: unknown, headers: Record<string, string>) => {
    const response = await fetch(`${origin}/api/operations/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
    // biome-ignore lint/suspicious/noExplicitAny: assertions narrow the JSON Result
    return { status: response.status, body: (await response.json()) as any };
  };
  const fromPage = () => ({ origin, [TOKEN_HEADER]: token });
  const result = { ref: "web/TC-0002", status: "passed" };

  it("hands the page a token and who it acts as, from git when nothing overrides it", async () => {
    await repository();
    const session = await start(await gitIdentity(root));
    expect(session).toMatchObject({
      ok: true,
      value: { identity: { email: "dev@acme.example", source: "git" } },
    });
    expect(session.value.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("refuses a write without the page's origin and token, and writes nothing", async () => {
    await repository();
    await start(await gitIdentity(root));
    const forbidden = { status: 403, body: { errors: [{ code: "ui.forbidden" }] } };
    expect(await write("run", result, {})).toMatchObject(forbidden);
    expect(await write("run", result, { origin })).toMatchObject(forbidden);
    expect(await write("run", result, { [TOKEN_HEADER]: token })).toMatchObject(forbidden);
    expect(
      await write("run", result, { origin: "http://evil.example", [TOKEN_HEADER]: token }),
    ).toMatchObject(forbidden);
    expect(
      await write("run", result, { origin, [TOKEN_HEADER]: `${token.slice(1)}A` }),
    ).toMatchObject(forbidden);
    expect(git(root, "status", "--porcelain")).toBe("");
    // Reads stay open to any local page.
    expect(await write("overview", {}, {})).toMatchObject({ status: 200, body: { ok: true } });
  });

  it("records a result and commits only the operation's file, as the git user", async () => {
    await repository();
    await start(await gitIdentity(root));
    await writeFile(join(root, "stray.txt"), "the human's own staged work\n");
    git(root, "add", "stray.txt");

    const { status, body } = await write("run", result, fromPage());
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      value: { ref: "web/TC-0002", event: { executor: "human:dev@acme.example" } },
    });
    const { commit } = body.value;
    expect(commit.sha).toBe(git(root, "rev-parse", "HEAD"));
    expect(commit.files).toEqual([body.value.path]);
    expect(commit.author).toBeUndefined();
    expect(git(root, "show", "--no-patch", "--format=%an <%ae>", "HEAD")).toBe(
      "Dev <dev@acme.example>",
    );
    expect(`${git(root, "show", "--no-patch", "--format=%B", "HEAD")}\n`).toBe(commit.message);
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe(body.value.path);
    // What the human had staged is still theirs, uncommitted.
    expect(git(root, "diff", "--cached", "--name-only")).toBe("stray.txt");

    // The browser's Sec-Fetch-Site says same-origin even when no Origin is sent.
    const again = await write(
      "run",
      { ...result, status: "failed" },
      { "sec-fetch-site": "same-origin", [TOKEN_HEADER]: token },
    );
    expect(again).toMatchObject({ status: 200, body: { ok: true } });
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("3");
  });

  it("commits with -c user.* when CASEFILE_USER_EMAIL overrides git, filling identity and via", async () => {
    await repository();
    await start({ email: "qa@acme.example", name: "QA Lead", source: "env" });
    const { status, body } = await write(
      "review",
      { ref: "web/TC-0001", to: "retired", identity: "spoof@acme.example", via: "cli:spoof" },
      fromPage(),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      value: { state: "retired", commit: { files: [CASE_FILE] } },
    });
    expect(git(root, "show", "--no-patch", "--format=%an <%ae>", "HEAD")).toBe(
      "QA Lead <qa@acme.example>",
    );
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe(CASE_FILE);
    const file = await readFile(join(root, CASE_FILE), "utf8");
    expect(file).toMatch(/by: qa@acme\.example\n {4}via: ui:review\n/);
    expect(file).not.toContain("spoof");
    expect(body.value.commit.message).toContain("Requested-by: qa@acme.example\n");
    expect(body.value.commit.message).not.toContain("Agent:");
  });

  it("reports a failing commit with git's stderr and leaves the files written", async () => {
    await repository(false);
    await start({ email: "qa@acme.example", source: "env" });
    const { status, body } = await write("run", result, fromPage());
    expect(status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      errors: [
        { code: "ui.commit_failed", message: expect.stringContaining("not a git repository") },
      ],
    });
    const today = new Date().toISOString().slice(0, 10);
    await expect(access(join(root, RUN_FILE, `manual-${today}.jsonl`))).resolves.toBeUndefined();
  });

  /** What `bin.ts` resolves when nothing overrides git: the repository's own user. */
  async function gitIdentity(dir: string): Promise<Identity> {
    return { email: git(dir, "config", "user.email"), source: "git" };
  }
});

describe("runs over examples/npm-login", () => {
  it("answers a failed case's runs newest first, with the failure's note and evidence", async () => {
    const npm = createUiServer({ root: NPM_LOGIN_ROOT, clientDir, identity: null });
    await new Promise<void>((done) => npm.listen(0, "127.0.0.1", done));
    try {
      const port = (npm.address() as AddressInfo).port;
      for (const [id, text] of Object.entries(NPM_LOGIN_EXPECTED.failureNotes)) {
        const response = await fetch(`http://127.0.0.1:${port}/api/operations/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ref: id }),
        });
        const body = (await response.json()) as {
          ok: boolean;
          value: { runs: { status: string; note?: string; evidence?: { kind: string }[] }[] };
        };
        expect(body.ok).toBe(true);
        const [latest] = body.value.runs;
        expect(body.value.runs).toHaveLength(NPM_LOGIN_EXPECTED.runCount[id as "TC-0002"]);
        expect(latest?.status).toBe("failed");
        expect(latest?.note).toContain(text);
        expect(latest?.evidence).toEqual([expect.objectContaining({ kind: "attachment" })]);
      }
    } finally {
      await new Promise((done) => npm.close(done));
    }
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
