import { describe, expect, it } from "vitest";
import {
  EVIDENCE_EXTENSIONS,
  EVIDENCE_MAX_ENTRIES,
  type EvidenceEntry,
  evidenceEntryProblems,
  evidenceKind,
  evidenceLimits,
  evidenceRunFile,
  extensionOf,
  isCheckedEvidence,
  isScriptExtension,
  isStoredEvidenceRef,
  sha256Hex,
  storedEvidenceName,
  storedEvidencePath,
} from "./evidence.js";

const codes = (entries: EvidenceEntry[], extensions = EVIDENCE_EXTENSIONS) =>
  evidenceEntryProblems(entries, extensions).map((p) => [p.code, p.field]);

describe("storedEvidenceName", () => {
  it.each([
    ["shot.png", "shot.png"],
    ["Login Error (1).PNG", "login-error--1-.png"],
    ["/tmp/a/b/Résumé.pdf", "r-sum-.pdf"],
    ["C:\\Users\\qa\\trace.har", "trace.har"],
    [".png", "file.png"],
    ["...", "file."],
    ["README", "readme"],
    ["été.log", "-t-.log"],
  ])("%s → %s", (original, stored) => {
    expect(storedEvidenceName(original)).toBe(stored);
  });

  it("keeps at most 60 characters, the extension kept", () => {
    const name = storedEvidenceName(`${"a".repeat(100)}.jpeg`);
    expect(name).toHaveLength(60);
    expect(name).toBe(`${"a".repeat(55)}.jpeg`);
    expect(storedEvidenceName("x".repeat(70))).toBe("x".repeat(60));
  });
});

describe("kinds, extensions and limits", () => {
  it("names the kind from the extension", () => {
    expect(["png", "JPG", "jpeg", "gif", "webp"].map(evidenceKind)).toEqual(Array(5).fill("image"));
    expect(["mp4", "webm"].map(evidenceKind)).toEqual(["video", "video"]);
    expect(["pdf", "txt", "log", "json", "har", "csv"].map(evidenceKind)).toEqual(
      Array(6).fill("file"),
    );
  });

  it("reads the extension lower-case, without the dot", () => {
    expect(extensionOf("/tmp/Shot.PNG")).toBe("png");
    expect(extensionOf("trace")).toBe("");
    expect(extensionOf(".bashrc")).toBe("bashrc");
    expect(extensionOf("archive.tar.GZ")).toBe("gz");
  });

  it("defaults to the ADR's list and 10 MB", () => {
    expect(evidenceLimits(undefined)).toEqual({
      extensions: [...EVIDENCE_EXTENSIONS],
      maxBytes: 10 * 1024 * 1024,
    });
  });

  it("replaces the list from casefile.yaml, never allowing a script type", () => {
    const limits = evidenceLimits({ max_file_mb: 0.5, extensions: [".CSV", "png", "svg", "HTML"] });
    expect(limits).toEqual({ extensions: ["csv", "png"], maxBytes: 512 * 1024 });
    expect(["svg", ".htm", "html", "XHTML", "xml", "js", "mjs"].every(isScriptExtension)).toBe(
      true,
    );
    expect(isScriptExtension("png")).toBe(false);
  });
});

describe("evidenceEntryProblems", () => {
  it("accepts allowed files and http(s) links", () => {
    expect(
      codes([
        { field: "evidence.0", file: "shot.png" },
        { field: "link.0", url: "https://example.com/bug/1" },
        { field: "attach.0", url: "http://ci.local/build/9", label: "CI build" },
      ]),
    ).toEqual([]);
  });

  it("refuses a type outside the list, a script type even when listed, and a bare name", () => {
    expect(
      codes(
        [
          { field: "evidence.0", file: "notes.docx" },
          { field: "evidence.1", file: "diagram.svg" },
          { field: "evidence.2", file: "Makefile" },
        ],
        evidenceLimits({ extensions: ["docx", "svg"] }).extensions.filter((e) => e !== "docx"),
      ),
    ).toEqual([
      ["evidence.type", "evidence.0"],
      ["evidence.type", "evidence.1"],
      ["evidence.type", "evidence.2"],
    ]);
    const [script] = evidenceEntryProblems([{ field: "evidence.0", file: "x.html" }], ["html"]);
    expect(script?.message).toContain("a browser would run them");
  });

  it("refuses a link that is not an http: or https: URL", () => {
    expect(
      codes([
        { field: "link.0", url: "javascript:alert(1)" },
        { field: "link.1", url: "not a url" },
        { field: "link.2", url: "file:///etc/passwd" },
      ]),
    ).toEqual([
      ["evidence.link", "link.0"],
      ["evidence.link", "link.1"],
      ["evidence.link", "link.2"],
    ]);
  });

  it(`refuses more than ${EVIDENCE_MAX_ENTRIES} entries, naming the first one over`, () => {
    const entries = Array.from({ length: EVIDENCE_MAX_ENTRIES + 1 }, (_, i) => ({
      field: `link.${i}`,
      url: `https://example.com/${i}`,
    }));
    expect(codes(entries)).toEqual([["evidence.too_many", `link.${EVIDENCE_MAX_ENTRIES}`]]);
    expect(codes(entries.slice(1))).toEqual([]);
  });
});

describe("where stored files live", () => {
  const sha = sha256Hex(new TextEncoder().encode("hello\n"));

  it("hashes with SHA-256", () => {
    expect(sha).toBe("5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
  });

  it("puts a file under .runs/<run>/<case>/<sha8>-<name>, POSIX and workspace-relative", () => {
    expect(storedEvidencePath("apps/web", "rc-1", "TC-0002", sha, "/tmp/Shot 1.PNG")).toBe(
      "apps/web/context/tests/.runs/rc-1/TC-0002/5891b5b5-shot-1.png",
    );
    expect(storedEvidencePath(".", "rc-1", "TC-0002", sha, "a.log")).toBe(
      "context/tests/.runs/rc-1/TC-0002/5891b5b5-a.log",
    );
  });

  it("knows a stored ref from anything else", () => {
    expect(isStoredEvidenceRef("apps/web/context/tests/.runs/rc-1/TC-0002/x.png", "apps/web")).toBe(
      true,
    );
    expect(isStoredEvidenceRef("context/tests/.runs/rc-1/x.png", ".")).toBe(true);
    for (const ref of [
      "context/tests/.runs/rc-1.jsonl",
      "context/tests/.runs/rc-1/",
      "context/tests/.runs/rc-1/../../../secret.txt",
      "context/tests/.runs/rc-1/./x.png",
      "/context/tests/.runs/rc-1/x.png",
      "test-results/x.png",
      "apps/api/context/tests/.runs/rc-1/x.png",
    ]) {
      expect([ref, isStoredEvidenceRef(ref, ref.startsWith("apps/") ? "apps/web" : ".")]).toEqual([
        ref,
        false,
      ]);
    }
  });

  it("finds the run file whose events name a stored ref", () => {
    expect(evidenceRunFile("apps/web/context/tests/.runs/rc-1/TC-0002/x.png", "apps/web")).toBe(
      "apps/web/context/tests/.runs/rc-1.jsonl",
    );
    expect(evidenceRunFile("context/tests/.runs/rc-1/x.png", ".")).toBe(
      "context/tests/.runs/rc-1.jsonl",
    );
    expect(evidenceRunFile("context/tests/.runs/rc-1/../../x.png", ".")).toBeNull();
    expect(evidenceRunFile("apps/api/context/tests/.runs/rc-1/x.png", "apps/web")).toBeNull();
  });

  it("checks stored files only, never links or ingest attachments", () => {
    const ref = "context/tests/.runs/r/TC-0001/x.png";
    expect(isCheckedEvidence({ kind: "image", ref }, ".")).toBe(true);
    expect(isCheckedEvidence({ kind: "attachment", ref }, ".")).toBe(false);
    expect(isCheckedEvidence({ kind: "link", ref: "https://example.com" }, ".")).toBe(false);
  });
});
