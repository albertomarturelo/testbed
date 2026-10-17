import { ChevronRight, Folder } from "lucide-react";
import type { CaseRow } from "@/api";
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
        <Branch key={node.path} node={node} project={project} selected={selected} depth={0} />
      ))}
    </nav>
  );
}

function Branch(props: { node: Node; project?: string; selected?: string; depth: number }) {
  const { node, project, selected, depth } = props;
  return (
    <>
      <a
        href={formatRoute({ view: "cases", project, feature: node.path })}
        className={cn(
          "flex items-center gap-1.5 rounded-md py-1 pr-2 hover:bg-accent",
          selected === node.path && "bg-accent font-medium",
        )}
        style={{ paddingLeft: `${0.5 + depth}rem` }}
      >
        {node.children.length > 0 ? (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        ) : (
          <Folder className="size-3.5 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-muted-foreground text-xs">{node.count}</span>
      </a>
      {node.children.map((child) => (
        <Branch
          key={child.path}
          node={child}
          project={project}
          selected={selected}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
