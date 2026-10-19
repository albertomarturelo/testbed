import { Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

const RUN: Record<string, Variant> = {
  passed: "default",
  failed: "destructive",
  blocked: "destructive",
  skipped: "outline",
  not_run: "outline",
};

const AUTOMATION: Record<string, Variant> = {
  automated: "default",
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
 * write-ownership); one nobody can automate is `not eligible`.
 */
export function automationKind(a: Automation): "status" | "linked" | "not_eligible" {
  if (FINAL.has(a.status)) return "status";
  if (a.ref !== null) return "linked";
  return a.eligible ? "status" : "not_eligible";
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
          {"linked · no run"}
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
    default:
      return <Badge variant={AUTOMATION[automation.status] ?? "outline"}>{status}</Badge>;
  }
}
