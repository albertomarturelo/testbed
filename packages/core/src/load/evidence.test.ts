import { describe, expect, it } from "vitest";
import type { Evidence, RunEvent } from "../schema/index.js";
import { namedStoredEvidence } from "./evidence.js";
import type { LoadedProject, LoadedWorkspace } from "./workspace.js";

const SHA = "a".repeat(64);

/** A workspace of run events only: all `namedStoredEvidence` reads. */
function workspace(projects: { path: string; evidence: Evidence[] }[]): LoadedWorkspace {
  return {
    root: "/repo",
    config: null,
    errors: [],
    projects: projects.map(
      ({ path, evidence }, i) =>
        ({
          name: `p${i}`,
          path,
          runs: [
            {
              path: `${path}/context/tests/.runs/r1.jsonl`,
              line: 1,
              event: {
                run_id: "r1",
                case_id: "TC-0001",
                status: "failed",
                executor: "human:qa@acme.example",
                at: "2026-11-20T10:00:00Z",
                evidence,
              } as RunEvent,
            },
          ],
        }) as unknown as LoadedProject,
    ),
  };
}

describe("namedStoredEvidence (ADR run-evidence-files §7)", () => {
  const stored = "apps/web/context/tests/.runs/r1/TC-0001/aaaaaaaa-shot.png";
  const loaded = workspace([
    {
      path: "apps/web",
      evidence: [
        { kind: "image", ref: stored, sha256: SHA, label: "The banner" },
        { kind: "link", ref: "https://example.com/bug/1" },
        { kind: "attachment", ref: "apps/web/context/tests/.runs/r1/TC-0001/trace.zip" },
        // Names a file of another project's directory: not this project's.
        { kind: "file", ref: "apps/api/context/tests/.runs/r1/TC-0001/x.log", sha256: SHA },
      ],
    },
    { path: "apps/api", evidence: [] },
  ]);

  it("answers the entry a run event names, with its kind and label", () => {
    expect(namedStoredEvidence(loaded, stored)).toEqual({
      kind: "image",
      ref: stored,
      sha256: SHA,
      label: "The banner",
    });
  });

  it("answers null for links, ingest references, other projects' paths and unnamed refs", () => {
    for (const ref of [
      "https://example.com/bug/1",
      "apps/web/context/tests/.runs/r1/TC-0001/trace.zip",
      "apps/api/context/tests/.runs/r1/TC-0001/x.log",
      "apps/web/context/tests/.runs/r1/TC-0001/other.png",
      "apps/web/context/tests/.runs/r1/TC-0001/../../../../../../etc/passwd",
    ]) {
      expect(namedStoredEvidence(loaded, ref)).toBeNull();
    }
  });
});
