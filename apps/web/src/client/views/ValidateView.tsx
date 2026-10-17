import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { call, type Result, type Validation } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/** `casefile validate`: no errors (warnings allowed), or every finding. */
export function ValidateView({ project }: { project?: string }) {
  const [result, setResult] = useState<Result<Validation> | null>(null);
  useEffect(() => {
    let current = true;
    setResult(null);
    call<Validation>("validate", { project }).then((r) => current && setResult(r));
    return () => {
      current = false;
    };
  }, [project]);

  if (result === null) return <Skeleton className="h-32 w-full" />;
  if (!result.ok) {
    const errors = result.errors.filter((e) => e.severity !== "warning").length;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {errors} {errors === 1 ? "error" : "errors"}, {result.errors.length - errors} warnings
        </p>
        <ErrorList errors={result.errors} />
      </div>
    );
  }
  const { value } = result;
  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <CircleCheck />
        <AlertTitle>Valid</AlertTitle>
        <AlertDescription>
          {value.projects} {value.projects === 1 ? "project" : "projects"}, {value.cases} case
          files, {value.warnings} {value.warnings === 1 ? "warning" : "warnings"}.
        </AlertDescription>
      </Alert>
      <ErrorList errors={value.findings} />
    </div>
  );
}
