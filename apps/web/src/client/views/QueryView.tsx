import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { call, type QueryAnswer, type Result } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRoute } from "@/route";

const EXAMPLES = [
  "automation.status != automated",
  "priority <= P1 AND state = active",
  "title CONTAINS login",
];

/** The query DSL over resolved cases (`casefile query`; ADR single-query-dsl). */
export function QueryView({ project }: { project?: string }) {
  const [text, setText] = useState("");
  const [ran, setRan] = useState<{ query: string; result: Result<QueryAnswer> } | null>(null);

  const run = async (query: string) => {
    if (query.trim() === "") return;
    setRan({ query, result: await call<QueryAnswer>("query", { query, project }) });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(text);
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label="Query"
          className="font-mono"
          placeholder="labels.risk = payments AND automation.status != automated"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit">
          <Search /> Run
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        Try:
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="rounded-md border px-2 py-0.5 font-mono hover:bg-accent"
            onClick={() => {
              setText(example);
              void run(example);
            }}
          >
            {example}
          </button>
        ))}
      </div>
      {ran === null ? null : ran.result.ok ? (
        <Answer answer={ran.result.value} />
      ) : (
        <div className="flex flex-col gap-2">
          <Caret
            query={ran.query}
            column={ran.result.errors.find((e) => e.field === "query")?.column}
          />
          <ErrorList errors={ran.result.errors} />
        </div>
      )}
    </div>
  );
}

function Answer({ answer }: { answer: QueryAnswer }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">
        {answer.count} {answer.count === 1 ? "case" : "cases"}
        {answer.unresolved > 0 ? ` · ${answer.unresolved} did not resolve (see Validate)` : ""}
      </p>
      {answer.count === 0 ? null : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Case</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {answer.cases.map((row) => (
              <TableRow key={row.ref}>
                <TableCell className="font-mono text-xs">
                  <a className="hover:underline" href={formatRoute({ view: "case", ref: row.ref })}>
                    {row.ref}
                  </a>
                </TableCell>
                <TableCell>{row.title}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.state}</Badge>
                </TableCell>
                <TableCell>{row.priority}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** The query with a `^` under the column of the error, as the CLI prints it. */
function Caret({ query, column }: { query: string; column: number | undefined }) {
  if (column === undefined) return null;
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm">
      {query}
      {"\n"}
      <span className="text-destructive">{`${" ".repeat(Math.max(0, column - 1))}^`}</span>
    </pre>
  );
}
