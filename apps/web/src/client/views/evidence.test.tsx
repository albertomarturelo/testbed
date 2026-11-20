// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSession, type Result } from "@/api";
import { CaseDetail } from "@/views/CaseDetail";

// Evidence when recording a result and in the run history (#204, ADR
// run-evidence-files §6–7).

/** What the fake API answers, per operation; inputs are recorded in `calls`. */
let answers: Record<string, (input: Record<string, unknown>) => Result<unknown>> = {};
const calls: { name: string; input: Record<string, unknown> }[] = [];
/** Each upload: the decoded name the header carried and the token sent. */
let uploads: { name: string; token: string | undefined }[] = [];
/** What an upload answers, by file name; staged by default. */
let uploadAnswer: (name: string) => Result<unknown>;

const stored = "apps/web/context/tests/.runs/manual-2026-11-20/TC-0001";
const recordedRuns: Record<string, unknown>[] = [];

beforeEach(() => {
  calls.length = 0;
  uploads = [];
  recordedRuns.length = 0;
  forgetSession();
  uploadAnswer = (name) => ({
    ok: true,
    value: { upload: `id-${uploads.length}`, name, size: 4, kind: "image" },
  });
  answers = {
    session: () => ({ ok: true, value: { token: "t", identity: null } }),
    "milestone-list": () => ({ ok: true, value: { milestones: [] } }),
    resolve: () => ({
      ok: true,
      value: {
        ref: "web/TC-0001",
        path: "apps/web/context/tests/login/TC-0001.md",
        inherited: [],
        case: {
          title: "Sign in",
          state: "active",
          priority: "P2",
          automation: { status: "manual", eligible: true },
        },
      },
    }),
    runs: () => ({ ok: true, value: { ref: "web/TC-0001", runs: recordedRuns } }),
  };
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: { body: unknown; headers?: Record<string, string> }) => {
      if (url === "/api/evidence") {
        const name = decodeURIComponent(init?.headers?.["x-casefile-filename"] ?? "");
        uploads.push({ name, token: init?.headers?.["x-casefile-token"] });
        return new Response(JSON.stringify(uploadAnswer(name)));
      }
      const name = url.split("/").at(-1) as string;
      const input =
        init === undefined ? {} : (JSON.parse(init.body as string) as Record<string, unknown>);
      if (init !== undefined) calls.push({ name, input });
      const answer = answers[name]?.(input) ?? {
        ok: false,
        errors: [{ code: "x", message: name }],
      };
      return new Response(JSON.stringify(answer));
    },
  );
});
afterEach(() => {
  window.sessionStorage.clear();
  cleanup();
  vi.unstubAllGlobals();
});

const runCalls = () => calls.filter((c) => c.name === "run").map((c) => c.input);
const png = (name: string) => new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/png" });

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  render(<CaseDetail caseRef="web/TC-0001" />);
  await user.click(await screen.findByRole("button", { name: "Record a result" }));
  const form = screen.getByRole("form", { name: "Record a result" });
  await user.selectOptions(within(form).getByLabelText("Result"), "failed");
  return form;
}

describe("Record a result: evidence (#204)", () => {
  it("uploads picked and pasted images at once and sends them with a link as attach", async () => {
    const user = userEvent.setup();
    answers.run = (input) => {
      recordedRuns.unshift({
        run_id: "manual-2026-11-20",
        case_id: "TC-0001",
        status: input.status,
        executor: "human:qa@acme.example",
        at: "2026-11-20T10:00:00Z",
        path: "apps/web/context/tests/.runs/manual-2026-11-20.jsonl",
      });
      return {
        ok: true,
        value: {
          ref: "web/TC-0001",
          run: "manual-2026-11-20",
          path: "p",
          appended: true,
          event: { status: input.status },
          commit: { message: "m", files: ["p"], sha: "4444444dddddd" },
          next: [],
        },
      };
    };
    const form = await openForm(user);
    await user.upload(within(form).getByLabelText("Evidence files"), png("Login error.png"));
    // Pasting text into the note stays text; pasting an image anywhere in the form attaches it.
    fireEvent.paste(within(form).getByLabelText("Note"), {
      clipboardData: { files: [png("image.png")] },
    });
    const files = within(form).getByRole("list", { name: "Files" });
    expect(within(files).getByText("Login error.png")).toBeTruthy();
    expect(within(files).getByText("image.png")).toBeTruthy();
    expect(within(files).getAllByText("4 B")).toHaveLength(2);
    await waitFor(() => expect(within(files).getAllByText("Uploaded")).toHaveLength(2));
    expect(uploads).toEqual([
      { name: "Login error.png", token: "t" },
      { name: "image.png", token: "t" },
    ]);
    await user.type(within(form).getByLabelText("Label of Login error.png"), " The banner ");

    await user.click(within(form).getByRole("button", { name: "Add a link" }));
    // The new link's URL has the focus.
    expect(document.activeElement).toBe(within(form).getByLabelText("Link 1 URL"));
    await user.keyboard("https://bugs.example.com/1");
    await user.type(within(form).getByLabelText("Link 1 label"), "Bug 1");
    // A link left empty is not sent.
    await user.click(within(form).getByRole("button", { name: "Add a link" }));
    await user.click(within(form).getByRole("button", { name: "Record" }));

    expect((await screen.findByRole("status")).textContent).toContain("Recorded failed");
    expect(runCalls()).toEqual([
      {
        ref: "web/TC-0001",
        status: "failed",
        attach: [
          { upload: "id-1", label: "The banner" },
          { upload: "id-2" },
          { url: "https://bugs.example.com/1", label: "Bug 1" },
        ],
      },
    ]);
  });

  it("shows an upload's error next to its file and sends nothing until it is removed", async () => {
    const user = userEvent.setup();
    answers.run = () => ({ ok: false, errors: [{ code: "x", message: "unused" }] });
    uploadAnswer = (name) =>
      name === "huge.mp4"
        ? {
            ok: false,
            errors: [{ code: "evidence.too_large", message: "huge.mp4 is 50 MB; at most 10 MB" }],
          }
        : { ok: true, value: { upload: "id-ok", name, size: 4, kind: "image" } };
    const form = await openForm(user);
    await user.upload(within(form).getByLabelText("Evidence files"), [
      png("huge.mp4"),
      png("ok.png"),
    ]);
    const files = within(form).getByRole("list", { name: "Files" });
    const huge = (await within(files).findByText(/huge\.mp4 is 50 MB/)).closest("li");
    expect(huge?.textContent).toContain("evidence.too_large");
    expect(huge?.textContent).toContain("huge.mp4");
    // Sending it again would fail the same way: no "Upload again".
    expect(within(huge as HTMLElement).queryByRole("button", { name: "Upload again" })).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Record" }));
    expect(within(form).getByText(/could not be uploaded/)).toBeTruthy();
    expect(runCalls()).toEqual([]);

    await user.click(within(form).getByRole("button", { name: "Remove huge.mp4" }));
    expect(within(form).queryByText("huge.mp4")).toBeNull();
    // Focus goes back to the picker's button, not to the page's start.
    expect(document.activeElement).toBe(within(form).getByRole("button", { name: "Choose files" }));
    await user.click(within(form).getByRole("button", { name: "Record" }));
    expect(runCalls()).toEqual([
      { ref: "web/TC-0001", status: "failed", attach: [{ upload: "id-ok" }] },
    ]);
  });

  it("places run's errors under the file or link they name, and uploads an expired file again", async () => {
    const user = userEvent.setup();
    answers.run = () => ({
      ok: false,
      errors: [
        { code: "ui.upload_unknown", field: "attach.0", message: "no upload: upload it again" },
        { code: "evidence.link", field: "attach.1", message: "'ftp://x' is not an http: URL" },
      ],
    });
    const form = await openForm(user);
    await user.upload(within(form).getByLabelText("Evidence files"), png("shot.png"));
    await within(form).findByText("Uploaded");
    await user.click(within(form).getByRole("button", { name: "Add a link" }));
    await user.keyboard("ftp://x");
    await user.click(within(form).getByRole("button", { name: "Record" }));

    const files = within(form).getByRole("list", { name: "Files" });
    expect(await within(files).findByText("no upload: upload it again")).toBeTruthy();
    const links = within(form).getByRole("list", { name: "Links" });
    expect(within(links).getByText("'ftp://x' is not an http: URL")).toBeTruthy();
    expect(within(form).getByLabelText("Link 1 URL").getAttribute("aria-invalid")).toBe("true");
    // Neither shows again as a whole-form alert.
    expect(form.querySelector('[data-slot="alert"]')).toBeNull();

    await user.click(within(files).getByRole("button", { name: "Upload again" }));
    expect(await within(files).findByText("Uploaded")).toBeTruthy();
    expect(within(files).queryByText("no upload: upload it again")).toBeNull();
    expect(uploads).toHaveLength(2);
  });
});

describe("Run history: evidence (#204)", () => {
  it("shows thumbnails that open full size, videos, downloads, links and labels", async () => {
    recordedRuns.push({
      run_id: "manual-2026-11-20",
      case_id: "TC-0001",
      status: "failed",
      executor: "human:qa@acme.example",
      at: "2026-11-20T10:00:00Z",
      path: "p",
      evidence: [
        { kind: "image", ref: `${stored}/1a2b3c4d-shot.png`, sha256: "a", label: "The banner" },
        { kind: "image", ref: `${stored}/5e6f7a8b-image.png`, sha256: "b" },
        { kind: "video", ref: `${stored}/0a0b0c0d-flow.webm`, sha256: "c" },
        { kind: "file", ref: `${stored}/0e0f0a0b-console.log`, sha256: "d", label: "Console" },
        { kind: "link", ref: "https://bugs.example.com/1", label: "Bug 1" },
        { kind: "link", ref: "javascript:alert(1)" },
        { kind: "attachment", ref: "test-results/x/trace.zip" },
      ],
    });
    render(<CaseDetail caseRef="web/TC-0001" />);
    const banner = (await screen.findByRole("img", { name: "The banner" })) as HTMLImageElement;
    const served = (name: string) => `/api/evidence?ref=${encodeURIComponent(`${stored}/${name}`)}`;
    expect(banner.getAttribute("src")).toBe(served("1a2b3c4d-shot.png"));
    expect(banner.getAttribute("loading")).toBe("lazy");
    const full = banner.closest("a");
    expect(full?.getAttribute("href")).toBe(served("1a2b3c4d-shot.png"));
    expect(full?.getAttribute("target")).toBe("_blank");
    expect(full?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("The banner").tagName).toBe("FIGCAPTION");
    // Without a label, the image is named by its file.
    expect(screen.getByRole("img", { name: "image.png" })).toBeTruthy();
    const video = document.querySelector("video");
    expect(video?.getAttribute("src")).toBe(served("0a0b0c0d-flow.webm"));
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("controls")).toBe(true);

    const download = screen.getByRole("link", { name: "Console" });
    expect(download.getAttribute("href")).toBe(served("0e0f0a0b-console.log"));
    expect(download.getAttribute("download")).toBe("console.log");
    const bug = screen.getByRole("link", { name: "Bug 1" });
    expect(bug.getAttribute("href")).toBe("https://bugs.example.com/1");
    expect(bug.getAttribute("target")).toBe("_blank");
    expect(bug.getAttribute("rel")).toBe("noopener noreferrer");
    // A link that is not http(s) never becomes one; ingest references stay text.
    expect(screen.getByText("javascript:alert(1)").closest("a")).toBeNull();
    expect(screen.getByText("test-results/x/trace.zip").closest("a")).toBeNull();
  });
});
