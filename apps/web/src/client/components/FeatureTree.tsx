import { ChevronRight, Folder } from "lucide-react";
import { useId } from "react";
import type { CaseRow } from "@/api";
import { useStoredFlag } from "@/lib/stored";
import { cn } from "@/lib/utils";
import { formatRoute } from "@/route";

type Node = { name: string; path: string; count: number; children: Node[] };

/** Feature directories of the cases, nested by `/`, each with its case count (subtree included). */
export function featureTree(rows: readonly CaseRow[]): Node[] {
  const root: Node = { name: "", path: "", count: 0, children: [] };
  for (const row of rows) {
    let node = root;
    for (const name of row.feature.split("/").filter((part) => part !== "" && part !== ".")) {
      const path = node.path === "" ? name : `${node.path}/${name}`;
      let child = node.children.find((c) => c.name === name);
      if (child === undefined) {
        child = { name, path, count: 0, children: [] };
        node.children.push(child);
      }
      child.count += 1;
      node = child;
    }
  }
  const sort = (nodes: Node[]): Node[] =>
    nodes
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => ({ ...n, children: sort(n.children) }));
  return sort(root.children);
}

/** Whether a case belongs to feature `selected` or a feature below it. */
export function inFeature(row: CaseRow, selected: string | undefined): boolean {
  return (
    selected === undefined || row.feature === selected || row.feature.startsWith(`${selected}/`)
  );
}

type Props = { project?: string; rows: readonly CaseRow[]; selected?: string };

/**
 * Where a viewer's choice to fold or unfold a parent feature is remembered
 * (CONVENTIONS 15). Per project, so `auth` in one project folds on its own.
 */
export function featureOpenKey(project: string | undefined, path: string): string {
  return `casefile.featureTree.open:${project ?? ""}:${path}`;
}

export function FeatureTree({ project, rows, selected }: Props) {
  return (
    <nav aria-label="Features" className="flex flex-col gap-0.5 text-sm">
      <a
        href={formatRoute({ view: "cases", project })}
        className={cn(
          "rounded-md px-2 py-1 hover:bg-accent",
          selected === undefined && "bg-accent font-medium",
        )}
      >
        All features <span className="text-muted-foreground">· {rows.length}</span>
      </a>
      {featureTree(rows).map((node) => (
        // The project is in the key: a stored flag is read once per mounted branch.
        <Branch
          key={`${project ?? ""}:${node.path}`}
          node={node}
          project={project}
          selected={selected}
          depth={0}
        />
      ))}
    </nav>
  );
}

type BranchProps = { node: Node; project?: string; selected?: string; depth: number };

function Branch(props: BranchProps) {
  const { node, depth } = props;
  const row = (marker: React.ReactNode) => (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md pr-2 hover:bg-accent",
        props.selected === node.path && "bg-accent font-medium",
      )}
      style={{ paddingLeft: `${0.25 + depth}rem` }}
    >
      {marker}
      <a
        href={formatRoute({ view: "cases", project: props.project, feature: node.path })}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
      >
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-muted-foreground text-xs">{node.count}</span>
      </a>
    </div>
  );
  if (node.children.length === 0) {
    return row(
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Folder className="size-3.5 text-muted-foreground" />
      </span>,
    );
  }
  return <Parent {...props} row={row} />;
}

function Parent(props: BranchProps & { row: (marker: React.ReactNode) => React.ReactNode }) {
  const { node, project, selected, depth, row } = props;
  const [stored, setStored] = useStoredFlag(featureOpenKey(project, node.path), true);
  // A deep link always shows where it is: the selected feature's ancestors stay open.
  const holdsSelected = selected?.startsWith(`${node.path}/`) === true;
  const open = stored || holdsSelected;
  const groupId = useId();
  return (
    <>
      {row(
        <button
          type="button"
          aria-expanded={open}
          aria-controls={groupId}
          aria-label={`Features under ${node.path}`}
          aria-disabled={holdsSelected || undefined}
          title={holdsSelected ? "Holds the selected feature" : open ? "Collapse" : "Expand"}
          onClick={() => {
            if (!holdsSelected) setStored(!open);
          }}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            holdsSelected ? "cursor-default" : "hover:bg-muted",
          )}
        >
          <ChevronRight
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        </button>,
      )}
      {/* Tailwind's preflight makes `hidden` win over `contents`. */}
      <div id={groupId} hidden={!open} className="contents">
        {node.children.map((child) => (
          <Branch
            key={child.path}
            node={child}
            project={project}
            selected={selected}
            depth={depth + 1}
          />
        ))}
      </div>
    </>
  );
}
