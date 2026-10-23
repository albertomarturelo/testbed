import { CircleCheck, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

const RUN: Record<string, Variant> = {
  passed: "default",
  failed: "destructive",
  blocked: "destructive",
  skipped: "outline",
  not_run: "outline",
};

/**
 * `automated` is derived and one agent run makes it (ADR write-ownership), so
 * it is lighter than a run result: the result is what stands out in a row.
 */
const AUTOMATION: Record<string, Variant> = {
  automated: "secondary",
  flaky: "destructive",
  candidate: "secondary",
  in_progress: "secondary",
};

/** A run status (`passed`, `failed`…) or `never ran`. */
export function RunBadge({ status }: { status: string | null }) {
  if (status === null) return <span className="text-muted-foreground text-xs">never ran</span>;
  return <Badge variant={RUN[status] ?? "outline"}>{status}</Badge>;
}

/** A case's resolved `automation`: its status, linked test (`null`: none) and eligibility. */
export type Automation = { status: string; ref: string | null; eligible: boolean };

/** Statuses that say all there is: proven by runs (`automated`, `flaky`) or `retired`. */
const FINAL = new Set(["automated", "flaky", "retired"]);

/**
 * What the human reads for a case's automation. A case linked to a test that no
 * CI or agent run reported yet is `linked`, not the `manual` it resolves to (ADR
 * write-ownership): not "never ran", since a human may have run it by hand. One
 * nobody can automate is `not eligible`. One that could be automated but has no
 * test yet is `no test`: `manual` would read as "tested by hand", which is what
 * `not eligible` means (#111). `candidate` and `in progress` say more, and stay.
 */
function automationKind(a: Automation): "status" | "linked" | "not_eligible" | "no_test" {
  if (FINAL.has(a.status)) return "status";
  if (a.ref !== null) return "linked";
  if (!a.eligible) return "not_eligible";
  return a.status === "manual" ? "no_test" : "status";
}

/** The resolved `automation.status`; `automated`/`flaky` come from runs. */
export function AutomationBadge({ automation }: { automation: Automation }) {
  const status = automation.status.replace("_", " ");
  switch (automationKind(automation)) {
    case "linked":
      return (
        <Badge
          variant="secondary"
          title={`Linked to ${automation.ref}; no CI or agent run reported it yet (${status})`}
        >
          <Link2 aria-hidden />
          linked
        </Badge>
      );
    case "not_eligible":
      return (
        <Badge
          variant="outline"
          className="border-dashed text-muted-foreground"
          title="automation.eligible is false: nobody can automate it"
        >
          not eligible
        </Badge>
      );
    case "no_test":
      return (
        <Badge variant="outline" title="Can be automated: no test is linked to it yet (manual)">
          no test
        </Badge>
      );
    default:
      return (
        <Badge variant={AUTOMATION[automation.status] ?? "outline"}>
          {automation.status === "automated" ? <CircleCheck aria-hidden /> : null}
          {status}
        </Badge>
      );
  }
}
