import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Identity } from "@casefile/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEMO_MONOREPO_EXPECTED,
  DEMO_MONOREPO_ROOT,
  NPM_LOGIN_EXPECTED,
  NPM_LOGIN_ROOT,
} from "../../../../packages/core/src/demo.fixture.js";
import { FILENAME_HEADER, UPLOAD_TTL_MS } from "./evidence.js";
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
    // No background maintenance writing into .git while afterEach removes it.
    git(root, "config", "maintenance.auto", "false");
    git(root, "config", "gc.auto", "0");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
  }

  async function start(identity: Identity | null, now?: () => number) {
    writer = createUiServer({ root, clientDir, identity, env: isolated, now });
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
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
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

  it("reports the ticket the branch names, and puts it in the commit subject (#158)", async () => {
    await repository();
    const config = join(root, "casefile.yaml");
    await writeFile(
      config,
      `${await readFile(config, "utf8")}commit:\n  subject: "[{ticket}] {type}({scope}): {summary}"\n  ticket_from_branch: "(PROJ-[0-9]+)"\n`,
    );
    git(root, "commit", "-q", "-am", "template");
    git(root, "checkout", "-q", "-b", "feature/PROJ-42-login");
    const session = await start(await gitIdentity(root));
    expect(session).toMatchObject({
      ok: true,
      value: { commit: { ticket: true, branchTicket: "PROJ-42" } },
    });
    // The branch is a host input: the page cannot set it.
    const { body } = await write("run", { ...result, branch: "main" }, fromPage());
    expect(body.value.commit.message.split("\n")[0]).toBe(
      "[PROJ-42] test(login): record TC-0002 as passed",
    );
    const typed = await write("run", { ...result, status: "failed", ticket: "QA-7" }, fromPage());
    expect(typed.body.value.commit.message.split("\n")[0]).toBe(
      "[QA-7] test(login): record TC-0002 as failed",
    );
  });

  it("says no ticket is needed with the default subject", async () => {
    await repository();
    expect(await start(await gitIdentity(root))).toMatchObject({
      value: { commit: { ticket: false } },
    });
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

  it("refuses a page that names a file on this machine as evidence, and writes nothing", async () => {
    await repository();
    await start(await gitIdentity(root));
    const refused = { status: 400, body: { errors: [{ code: "ui.local_file" }] } };
    expect(
      await write("run", { ...result, evidence: ["/etc/hosts.txt"] }, fromPage()),
    ).toMatchObject(refused);
    expect(
      await write("run", { ...result, attach: [{ file: "/etc/hosts.txt" }] }, fromPage()),
    ).toMatchObject(refused);
    expect(git(root, "status", "--porcelain")).toBe("");
    // A link names nothing local.
    const linked = await write(
      "run",
      { ...result, attach: [{ url: "https://example.com/bug/1", label: "Bug" }] },
      fromPage(),
    );
    expect(linked.body).toMatchObject({
      ok: true,
      value: { event: { evidence: [{ kind: "link", label: "Bug" }] } },
    });
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

  describe("evidence (ADR run-evidence-files §6–7)", () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const upload = async (
      name: string,
      body: Uint8Array | string | ReadableStream<Uint8Array>,
      headers: Record<string, string> = fromPage(),
    ) => {
      const response = await fetch(`${origin}/api/evidence`, {
        method: "POST",
        headers: { [FILENAME_HEADER]: encodeURIComponent(name), ...headers },
        body,
        // A stream body goes chunked, without a Content-Length.
        ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit);
      // biome-ignore lint/suspicious/noExplicitAny: assertions narrow the JSON Result
      return { status: response.status, body: (await response.json()) as any };
    };
    /** A raw upload from the page, chunked (no Content-Length); the caller writes and ends it. */
    const rawUpload = (name: string) => {
      const url = new URL(origin);
      return request({
        host: url.hostname,
        port: url.port,
        path: "/api/evidence",
        method: "POST",
        headers: { ...fromPage(), [FILENAME_HEADER]: encodeURIComponent(name) },
      }).on("error", () => {
        // The server drops the connection on purpose; the answer, if any, came first.
      });
    };
    /** Every upload directory staged under the OS temp dir, by any server. */
    const stagedIds = async () => {
      const ids: string[] = [];
      for (const dir of await readdir(tmpdir())) {
        if (!dir.startsWith("casefile-uploads-")) continue;
        ids.push(...(await readdir(join(tmpdir(), dir)).catch((): string[] => [])));
      }
      return ids.sort();
    };
    const until = async (check: () => Promise<boolean>) => {
      for (let i = 0; i < 100 && !(await check()); i++) {
        await new Promise((done) => setTimeout(done, 20));
      }
      expect(await check()).toBe(true);
    };
    const served = (ref: string) => fetch(`${origin}/api/evidence?ref=${encodeURIComponent(ref)}`);
    /** Whether an upload's directory is still staged under the OS temp dir. */
    const staged = async (id: string) => {
      for (const dir of await readdir(tmpdir())) {
        if (!dir.startsWith("casefile-uploads-")) continue;
        const ids = await readdir(join(tmpdir(), dir)).catch((): string[] => []);
        if (ids.includes(id)) return true;
      }
      return false;
    };

    it("stages an upload, swaps it into run, commits the file and removes the upload", async () => {
      await repository();
      await start(await gitIdentity(root));
      const up = await upload("Login Error.PNG", PNG);
      expect(up).toMatchObject({
        status: 200,
        body: { ok: true, value: { name: "Login Error.PNG", size: PNG.length, kind: "image" } },
      });
      const id: string = up.body.value.upload;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await staged(id)).toBe(true);

      const { status, body } = await write(
        "run",
        {
          ...result,
          status: "failed",
          attach: [
            { upload: id, label: "The banner" },
            { url: "https://example.com/bug/1", label: "Bug" },
          ],
        },
        fromPage(),
      );
      expect(status).toBe(200);
      const [image, link] = body.value.event.evidence;
      expect(image).toMatchObject({ kind: "image", label: "The banner" });
      expect(image.ref).toMatch(
        /^apps\/web\/context\/tests\/\.runs\/manual-[\d-]+\/TC-0002\/[0-9a-f]{8}-login-error\.png$/,
      );
      expect(link).toEqual({ kind: "link", ref: "https://example.com/bug/1", label: "Bug" });
      expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(
        [body.value.path, image.ref].sort(),
      );
      expect(new Uint8Array(await readFile(join(root, image.ref)))).toEqual(PNG);
      // Recorded: the upload is gone, and naming it again is refused.
      expect(await staged(id)).toBe(false);
      expect(await write("run", { ...result, attach: [{ upload: id }] }, fromPage())).toMatchObject(
        { status: 400, body: { errors: [{ code: "ui.upload_unknown", field: "attach.0" }] } },
      );
    });

    it("keeps the uploads of a refused result, so it can be sent again", async () => {
      await repository();
      await start(await gitIdentity(root));
      const id = (await upload("shot.png", PNG)).body.value.upload;
      const refused = await write(
        "run",
        { ...result, attach: [{ upload: id, label: "x".repeat(121) }] },
        fromPage(),
      );
      expect(refused.body.ok).toBe(false);
      expect(await staged(id)).toBe(true);
      const again = await write("run", { ...result, attach: [{ upload: id }] }, fromPage());
      expect(again).toMatchObject({ status: 200, body: { ok: true } });
    });

    it("refuses an upload without the page's origin and token, and stages nothing", async () => {
      await repository();
      await start(await gitIdentity(root));
      const forbidden = { status: 403, body: { errors: [{ code: "ui.forbidden" }] } };
      expect(await upload("shot.png", PNG, {})).toMatchObject(forbidden);
      expect(await upload("shot.png", PNG, { origin })).toMatchObject(forbidden);
      expect(await upload("shot.png", PNG, { [TOKEN_HEADER]: token })).toMatchObject(forbidden);
      expect(
        await upload("shot.png", PNG, { origin: "http://evil.example", [TOKEN_HEADER]: token }),
      ).toMatchObject(forbidden);
    });

    it("applies casefile.yaml's limits: size, script types, other types, a name", async () => {
      await repository();
      const config = join(root, "casefile.yaml");
      await appendFile(config, "evidence:\n  max_file_mb: 0.001\n");
      await start(await gitIdentity(root));
      const big = new Uint8Array(2000);
      const tooLarge = { status: 413, body: { errors: [{ code: "evidence.too_large" }] } };
      // Declared too large up front.
      expect(await upload("big.png", big)).toMatchObject(tooLarge);
      // Chunked, without a Content-Length, and never ending: the server stops
      // reading past the limit, answers and drops the connection.
      const before = await stagedIds();
      const endless = await new Promise<{ status?: number; connection?: string; body: string }>(
        (done) => {
          const sending = rawUpload("big.png");
          const timer = setInterval(() => sending.write(new Uint8Array(512)), 2);
          sending.on("response", (response) => {
            clearInterval(timer);
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () =>
              done({ status: response.statusCode, connection: response.headers.connection, body }),
            );
          });
        },
      );
      expect(endless).toMatchObject({ status: 413, connection: "close" });
      expect(JSON.parse(endless.body)).toMatchObject(tooLarge.body);
      expect(await stagedIds()).toEqual(before);
      for (const name of ["x.svg", "page.html", "tool.exe", "README"]) {
        expect(await upload(name, PNG)).toMatchObject({
          status: 400,
          body: { errors: [{ code: "evidence.type" }] },
        });
      }
      const nameless = await fetch(`${origin}/api/evidence`, {
        method: "POST",
        headers: fromPage(),
        body: PNG,
      });
      expect(nameless.status).toBe(400);
      expect(await upload("ok.png", PNG)).toMatchObject({ status: 200 });
    });

    it("refuses an unknown or expired upload, and still refuses local files", async () => {
      await repository();
      let now = Date.now();
      await start(await gitIdentity(root), () => now);
      const unknown = await write("run", { ...result, attach: [{ upload: "nope" }] }, fromPage());
      expect(unknown).toMatchObject({
        status: 400,
        body: { errors: [{ code: "ui.upload_unknown", field: "attach.0" }] },
      });
      const id = (await upload("shot.png", PNG)).body.value.upload;
      now += UPLOAD_TTL_MS;
      const expired = await write(
        "run",
        { ...result, attach: [{ url: "https://example.com" }, { upload: id }] },
        fromPage(),
      );
      expect(expired).toMatchObject({
        status: 400,
        body: { errors: [{ code: "ui.upload_unknown", field: "attach.1" }] },
      });
      expect(await staged(id)).toBe(false);
      // An upload never lets the page name a path.
      expect(
        await write("run", { ...result, attach: [{ upload: id, file: "/etc/hosts" }] }, fromPage()),
      ).toMatchObject({ status: 400, body: { errors: [{ code: "ui.local_file" }] } });
      expect(git(root, "status", "--porcelain")).toBe("");
    });

    it("commits an evidence file the host repository ignores", async () => {
      await repository();
      await writeFile(join(root, ".gitignore"), "*.log\n");
      git(root, "add", ".gitignore");
      git(root, "commit", "-q", "-m", "ignore logs");
      await start(await gitIdentity(root));
      const id = (await upload("console.log", "TypeError: x is undefined\n")).body.value.upload;
      const { status, body } = await write(
        "run",
        { ...result, status: "failed", attach: [{ upload: id }] },
        fromPage(),
      );
      expect(status).toBe(200);
      const [log] = body.value.event.evidence;
      expect(log).toMatchObject({ kind: "file" });
      expect(log.ref).toMatch(/-console\.log$/);
      expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n")).toContain(log.ref);
      expect(git(root, "status", "--porcelain")).toBe("");
    });

    it("serves stored evidence a run event names, with safe headers, and nothing else", async () => {
      await repository();
      await start(await gitIdentity(root));
      const png = (await upload("shot.png", PNG)).body.value.upload;
      const pdf = (await upload("report.pdf", "%PDF-1.4\n")).body.value.upload;
      const { body } = await write(
        "run",
        { ...result, attach: [{ upload: png }, { upload: pdf }] },
        fromPage(),
      );
      const [image, file] = body.value.event.evidence.map((e: { ref: string }) => e.ref);

      const shown = await served(image);
      expect(shown.status).toBe(200);
      expect(shown.headers.get("content-type")).toBe("image/png");
      expect(shown.headers.get("x-content-type-options")).toBe("nosniff");
      expect(shown.headers.get("cache-control")).toBe("no-store");
      expect(shown.headers.get("content-disposition")).toMatch(
        /^inline; filename="[0-9a-f]{8}-shot\.png"$/,
      );
      expect(new Uint8Array(await shown.arrayBuffer())).toEqual(PNG);
      const download = await served(file);
      expect(download.headers.get("content-type")).toBe("application/pdf");
      expect(download.headers.get("content-disposition")).toMatch(/^attachment; /);
      expect(download.headers.get("x-content-type-options")).toBe("nosniff");

      // A file in .runs/ that no event names, a symlinked file and a symlinked
      // directory events name, traversal. The events sit in each ref's own run
      // file, the one the server reads: a regular file named there is served.
      const dir = image.slice(0, image.lastIndexOf("/"));
      const run = dir.split("/").at(-2) as string;
      await writeFile(join(root, dir, "unnamed.png"), PNG);
      await writeFile(join(root, dir, "named.png"), PNG);
      await symlink(join(root, "casefile.yaml"), join(root, dir, "link.png"));
      const outside = await mkdtemp(join(tmpdir(), "casefile-outside-"));
      await writeFile(join(outside, "x.png"), PNG);
      await mkdir(join(root, RUN_FILE, "linked"));
      await symlink(outside, join(root, RUN_FILE, "linked", "TC-0002"));
      const event = (runId: string, refs: string[]) =>
        `${JSON.stringify({
          run_id: runId,
          case_id: "TC-0002",
          status: "failed",
          executor: "human:dev@acme.example",
          at: "2026-11-20T10:00:00Z",
          evidence: refs.map((ref) => ({ kind: "image", ref, sha256: "a".repeat(64) })),
        })}\n`;
      const linkedFile = `${dir}/link.png`;
      const linkedDir = `${RUN_FILE}/linked/TC-0002/x.png`;
      const escaping = `${dir}/../../../../../../casefile.yaml`;
      await appendFile(
        join(root, RUN_FILE, `${run}.jsonl`),
        event(run, [`${dir}/named.png`, linkedFile, escaping]),
      );
      await writeFile(join(root, RUN_FILE, "linked.jsonl"), event("linked", [linkedDir]));
      expect((await served(`${dir}/named.png`)).status).toBe(200);
      expect((await served(image)).status).toBe(200);
      for (const ref of [
        `${dir}/unnamed.png`,
        linkedFile,
        linkedDir,
        escaping,
        "casefile.yaml",
        "apps/web/context/tests/.runs/nope/TC-0002/x.png",
        "",
      ]) {
        const refused = await served(ref);
        expect([ref, refused.status]).toEqual([ref, 404]);
        expect(await refused.json()).toMatchObject({
          errors: [{ code: "ui.evidence_not_found" }],
        });
      }
      await rm(outside, { recursive: true, force: true });
      // Reads need no token; anything but GET and POST is refused.
      expect((await fetch(`${origin}/api/evidence`, { method: "PUT" })).status).toBe(405);
    });

    it("removes a partial upload the client cuts off", async () => {
      await repository();
      await start(await gitIdentity(root));
      const before = await stagedIds();
      const sending = rawUpload("shot.png");
      sending.write(PNG);
      await until(async () => (await stagedIds()).length > before.length);
      sending.destroy();
      await until(async () => (await stagedIds()).length === before.length);
      expect(await upload("again.png", PNG)).toMatchObject({ status: 200 });
    });

    it("drops an upload the page removed, behind the write guard, idempotently", async () => {
      await repository();
      await start(await gitIdentity(root));
      const id = (await upload("shot.png", PNG)).body.value.upload;
      const drop = (headers: Record<string, string>, path = `/api/evidence/${id}`) =>
        fetch(`${origin}${path}`, { method: "DELETE", headers });
      expect((await drop({})).status).toBe(403);
      expect((await drop({ origin })).status).toBe(403);
      expect(await staged(id)).toBe(true);
      const dropped = await drop(fromPage());
      expect(dropped.status).toBe(200);
      expect(await dropped.json()).toEqual({ ok: true, value: { upload: id } });
      expect(await staged(id)).toBe(false);
      expect((await drop(fromPage())).status).toBe(200);
      expect((await drop(fromPage(), "/api/evidence")).status).toBe(405);
      expect(await write("run", { ...result, attach: [{ upload: id }] }, fromPage())).toMatchObject(
        { status: 400, body: { errors: [{ code: "ui.upload_unknown" }] } },
      );
    });

    it("removes staged uploads when the server closes", async () => {
      await repository();
      await start(await gitIdentity(root));
      const id = (await upload("shot.png", PNG)).body.value.upload;
      expect(await staged(id)).toBe(true);
      await new Promise((done) => writer?.close(done));
      writer = null;
      expect(await staged(id)).toBe(false);
    });
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

/** The built host, as `casefile ui` starts it (CI builds before it tests). */
const BIN = fileURLToPath(new URL("../../dist/server/bin.js", import.meta.url));

describe.skipIf(!existsSync(BIN))("the built host stopped by Ctrl-C (#204)", () => {
  it("removes its staged uploads even when SIGINT comes twice, as through `casefile ui`", async () => {
    const child = spawn(process.execPath, [BIN, "--cwd", DEMO_MONOREPO_ROOT, "--port", "0"], {
      env: { ...process.env, CASEFILE_USER_EMAIL: "qa@acme.example" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
    try {
      const port = await new Promise<string>((done) => {
        let out = "";
        child.stdout.on("data", (chunk) => {
          out += chunk;
          const found = /127\.0\.0\.1:(\d+)/.exec(out);
          if (found?.[1] !== undefined) done(found[1]);
        });
      });
      const host = `http://127.0.0.1:${port}`;
      const session = (await (await fetch(`${host}/api/session`)).json()) as {
        value: { token: string };
      };
      const uploaded = (await (
        await fetch(`${host}/api/evidence`, {
          method: "POST",
          headers: {
            origin: host,
            [TOKEN_HEADER]: session.value.token,
            [FILENAME_HEADER]: "shot.png",
          },
          body: new Uint8Array([1, 2, 3]),
        })
      ).json()) as { value: { upload: string } };
      const dirs = (await readdir(tmpdir())).filter((d) => d.startsWith("casefile-uploads-"));
      const stage = (
        await Promise.all(
          dirs.map(async (d) =>
            (
              await readdir(join(tmpdir(), d)).catch((): string[] => [])
            ).includes(uploaded.value.upload)
              ? d
              : null,
          ),
        )
      ).find((d) => d !== null);
      expect(stage).toBeDefined();

      // The terminal's SIGINT, then the one `casefile ui` forwards.
      child.kill("SIGINT");
      child.kill("SIGINT");
      expect(await exited).toBe(0);
      expect(existsSync(join(tmpdir(), stage as string))).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });
});
