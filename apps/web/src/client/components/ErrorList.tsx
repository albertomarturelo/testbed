import { CircleAlert, TriangleAlert } from "lucide-react";
import type { CasefileError } from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Errors and findings as `casefile` prints them: code, location, message, hint. */
export function ErrorList({ errors }: { errors: readonly CasefileError[] }) {
  return (
    <div className="flex flex-col gap-2">
      {errors.map((e, i) => {
        const warning = e.severity === "warning";
        // `path:line:column` in a file; a bare column belongs to a one-line input (a query).
        const at =
          e.path !== undefined
            ? [e.path, e.line, e.column].filter((part) => part !== undefined).join(":")
            : e.column !== undefined
              ? `column ${e.column}`
              : "";
        return (
          // Findings have no id; the same code can repeat on several files.
          // biome-ignore lint/suspicious/noArrayIndexKey: list is replaced, never reordered
          <Alert key={i} variant={warning ? "default" : "destructive"}>
            {warning ? <TriangleAlert /> : <CircleAlert />}
            <AlertTitle className="font-mono text-xs">
              {e.code}
              {at === "" ? "" : `  ${at}`}
            </AlertTitle>
            <AlertDescription>
              <p>{e.message}</p>
              {e.hint === undefined ? null : <p className="text-muted-foreground">{e.hint}</p>}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
