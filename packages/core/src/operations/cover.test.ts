import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_MONOREPO_ROOT } from "../demo.fixture.js";
import { commitMessage } from "../git/trailers.js";
import { parseCaseFile } from "../load/parse.js";
import { coverOperation } from "./cover.js";
import { createRegistry } from "./registry.js";
import { CORE_SPECS_DIR } from "./spec.js";
import { validateOperation } from "./validate.js";

const registry = createRegistry();
registry.register(coverOperation);
registry.register(validateOperation);

const LOGIN = "apps/web/context/tests/login";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "casefile-cover-"));
  await cp(DEMO_MONOREPO_ROOT, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

type Covered = {
  project: string;
  feature: string;
  change: string;
  created: { ref: string; path: string }[];
  commit: { author: string; message: string };
  next: string[];
};

const base = { project: "web", requestedBy: "qa@acme.example", agent: "claude-code" };
const step = { do: "Submit the form", expect: "The form is rejected" };
const cover = (input: Record<string, unknown>, actor: "agent" | "human" = "agent") =>
  registry.invoke("cover", { ...base, feature: "login", ...input }, { root, actor });
const covered = async (input: Record<string, unknown>) => {
  const result = await cover(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value as Covered;
};
const loginFiles = async () => (await readdir(join(root, LOGIN))).sort();

/** The CLI example and the file it writes, both taken from `casefile spec cover`. */
async function specExample() {
  const spec = await readFile(join(CORE_SPECS_DIR, "cover.md"), "utf8");
  const cases = /--cases '(\[[\s\S]*?\])'/.exec(spec)?.[1];
  const file = /^```markdown TC-0003\.md\n([\s\S]*?)^```$/m.exec(spec)?.[1];
  if (cases === undefined || file === undefined) throw new Error("cover.md lost its example");
  return { cases: JSON.parse(cases) as unknown[], file };
}

describe("cover", () => {
  it("writes the file `casefile spec cover` shows and returns the commit", async () => {
    const example = await specExample();
    const value = await covered({ cases: example.cases });
    expect(value.created).toEqual([{ ref: "web/TC-0003", path: `${LOGIN}/TC-0003.md` }]);
    expect(value.change).toMatch(UUID);

    const written = await readFile(join(root, LOGIN, "TC-0003.md"), "utf8");
    const at = /at: "([^"]+)"/.exec(written)?.[1] as string;
    expect(Date.now() - Date.parse(at)).toBeLessThan(60_000);
    expect(written).toBe(
      example.file
        .replace(/at: "[^"]+"/, `at: "${at}"`)
        .replace(/change: \S+/, `change: ${value.change}`),
    );

    expect(value.commit).toEqual({
      author: "casefile-agent <casefile-agent@casefile.invalid>",
      message: commitMessage("cover(login): propose 1 case", { ...base, change: value.change }),
    });
    expect(value.next[0]).toContain("-- <paths>");
    expect(value.next[0]).toContain("--json");
    expect(value.next[1]).toContain("web/TC-0003");
  });

  it("gives consecutive ids and one change id to every case, which then validate", async () => {
    const value = await covered({
      cases: [
        { title: "Reject an empty email", steps: [step], notes: "Seen in support ticket 12." },
        { title: "Reject an empty password", steps: [step], labels: { owner_team: "storefront" } },
      ],
      inbox: "7f3c",
    });
    expect(value.created.map((c) => c.ref)).toEqual(["web/TC-0003", "web/TC-0004"]);
    expect(value.commit.message).toContain("Inbox-Id: 7f3c\n");
    expect(value.commit.message.startsWith("cover(login): propose 2 cases\n")).toBe(true);
    for (const { path } of value.created) {
      const parsed = parseCaseFile(path, await readFile(join(root, path), "utf8"));
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      expect(parsed.value.file).toMatchObject({
        state: "draft",
        origin: "agent",
        history: [{ by: "qa@acme.example", via: "cli:cover", change: value.change, inbox: "7f3c" }],
      });
    }
    const body = (await readFile(join(root, `${LOGIN}/TC-0003.md`), "utf8")).split("---\n")[2];
    expect(body).toBe("\nSeen in support ticket 12.\n");
    expect(await registry.invoke("validate", {}, { root, actor: "agent" })).toMatchObject({
      ok: true,
    });
  });

  it("creates a new feature directory", async () => {
    const value = await covered({
      feature: "signup/email",
      cases: [{ title: "Sign up", steps: [step] }],
    });
    expect(value.created[0]?.path).toBe("apps/web/context/tests/signup/email/TC-0003.md");
  });
});

describe("cover refuses, writing nothing", () => {
  const refused = async (input: Record<string, unknown>, code: string, field?: string) => {
    const before = await loginFiles();
    const result = await cover(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code, ...(field === undefined ? {} : { field }) }),
      );
    }
    expect(await loginFiles()).toEqual(before);
  };

  it("a title the feature already has, or that repeats in the call", async () => {
    // `web/TC-0002` is "Reject a wrong password"; case and spacing do not matter.
    const ok = { title: "Something new", steps: [step] };
    await refused(
      { cases: [ok, { title: "reject a  wrong password", steps: [step] }] },
      "cover.duplicate_title",
      "cases.1.title",
    );
    await refused(
      { cases: [ok, { title: "Something new", steps: [step] }] },
      "cover.duplicate_title",
      "cases.1.title",
    );
  });

  it("fields that are casefile's to write", async () => {
    for (const extra of [
      { state: "active" },
      { id: "TC-0100" },
      { automation: { status: "manual" } },
      { title: "Line one\nline two" },
    ]) {
      await refused(
        { cases: [{ title: "T", steps: [step], ...extra }] },
        "operation.invalid_input",
      );
    }
  });

  it("a case that would not resolve, or an undeclared label", async () => {
    await writeFile(
      join(root, "apps/web/context/tests/_common.yaml"),
      "surfaces: [web]\nlayer: e2e\nautomation:\n  eligible: true\n",
    );
    await refused(
      { cases: [{ title: "T", steps: [step] }] },
      "resolve.missing_field",
      "cases.0.priority",
    );
    await refused(
      { cases: [{ title: "T", steps: [step], priority: "P1", labels: { nope: "x" } }] },
      "label.undeclared",
      "cases.0.labels.nope",
    );
  });

  it("more cases than review.max_batch", async () => {
    await writeFile(
      join(root, LOGIN, "_common.yaml"),
      "review:\n  mode: required\n  max_batch: 1\n",
    );
    await refused(
      {
        cases: [
          { title: "A", steps: [step] },
          { title: "B", steps: [step] },
        ],
      },
      "cover.batch_too_large",
      "cases",
    );
  });

  it("a path for a new id that is taken by something that is not a case", async () => {
    await mkdir(join(root, LOGIN, "TC-0003.md"));
    await refused({ cases: [{ title: "T", steps: [step] }] }, "cover.file_exists");
  });

  it("an unknown project", async () => {
    await refused({ project: "nope", cases: [{ title: "T", steps: [step] }] }, "project.unknown");
  });

  it("no project chosen in a workspace of several, or a human actor", async () => {
    const before = await loginFiles();
    expect(
      await registry.invoke(
        "cover",
        { ...base, project: undefined, feature: "login", cases: [{ title: "T", steps: [step] }] },
        { root, actor: "agent" },
      ),
    ).toMatchObject({ ok: false, errors: [{ code: "project.required" }] });
    expect(await cover({ cases: [{ title: "T", steps: [step] }] }, "human")).toMatchObject({
      ok: false,
      errors: [{ code: "operation.actor_not_allowed" }],
    });
    expect(await loginFiles()).toEqual(before);
  });
});
