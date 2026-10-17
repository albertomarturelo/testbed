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

/** The resolved `automation.status`; `automated`/`flaky` come from runs. */
export function AutomationBadge({ status }: { status: string }) {
  return <Badge variant={AUTOMATION[status] ?? "outline"}>{status.replace("_", " ")}</Badge>;
}
