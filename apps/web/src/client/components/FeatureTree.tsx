import { ChevronRight, Folder } from "lucide-react";
import { useId } from "react";
import type { CaseRow } from "@/api";
import { useStoredFlag } from "@/lib/stored";
import { cn } from "@/lib/utils";
import { formatRoute } from "@/route";

/** What a feature covers: its cases by state, and how many are linked to a test (#87). */
export type Tally = { states: Record<string, number>; linked: number };

type Node = { name: string; path: string; count: number; tally: Tally; children: Node[] };

/** States in the order a reader follows a case through them; others come after, by name. */
const STATE_ORDER = ["draft", "in_review", "active", "retired"];

/** Cases by state and linked to a test, over `rows`. */
export function tally(rows: readonly CaseRow[]): Tally {
  const counted: Tally = { states: {}, linked: 0 };
  for (const row of rows) add(counted, row);
  return counted;
}

function add(counted: Tally, row: CaseRow): void {
  counted.states[row.state] = (counted.states[row.state] ?? 0) + 1;
  if (row.automation_ref !== null) counted.linked += 1;
}

/** `1 draft · 2 active · 1 linked`: states that have cases, then the linked count. */
export function tallyLine({ states, linked }: Tally): string {
  const rank = (state: string) => {
    const i = STATE_ORDER.indexOf(state);
    return i === -1 ? STATE_ORDER.length : i;
  };
  const parts = Object.entries(states)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([state, n]) => `${n} ${state.replaceAll("_", " ")}`);
  return [...parts, `${linked} linked`].join(" · ");
}

/** The parts of a feature path, as the tree nests them (`auth//login/` and `./auth/login` are `auth/login`). */
function featureParts(feature: string): string[] {
  return feature.split("/").filter((part) => part !== "" && part !== ".");
}

/** Tree order: a parent before what is below it, siblings by name, as the feature tree lists them. */
export function compareFeatures(a: string, b: string): number {
  const pa = featureParts(a);
  const pb = featureParts(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    const order = (pa[i] as string).localeCompare(pb[i] as string);
    if (order !== 0) return order;
  }
  return pa.length - pb.length;
}

/**
 * Feature directories of the cases, nested by `/`, each with its case count and
 * tally (subtree included).
 */
export function featureTree(rows: readonly CaseRow[]): Node[] {
  const root: Node = { name: "", path: "", count: 0, tally: tally([]), children: [] };
  for (const row of rows) {
    let node = root;
    for (const name of featureParts(row.feature)) {
      const path = node.path === "" ? name : `${node.path}/${name}`;
      let child = node.children.find((c) => c.name === name);
      if (child === undefined) {
        child = { name, path, count: 0, tally: tally([]), children: [] };
        node.children.push(child);
      }
      child.count += 1;
      add(child.tally, row);
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

/** `state`: the list's state filter (#87); the tree's links keep it, its counts ignore it. */
type Props = { project?: string; rows: readonly CaseRow[]; selected?: string; state?: string };

/**
 * Where a viewer's choice to fold or unfold a parent feature is remembered
 * (CONVENTIONS 15). Per project, so `auth` in one project folds on its own.
 */
export function featureOpenKey(project: string | undefined, path: string): string {
  return `casefile.featureTree.open:${project ?? ""}:${path}`;
}

export function FeatureTree({ project, rows, selected, state }: Props) {
  return (
    <nav aria-label="Features" className="flex flex-col gap-0.5 text-sm">
      <a
        href={formatRoute({ view: "cases", project, state })}
        className={cn(
          "flex flex-col rounded-md px-2 py-1 hover:bg-accent",
          selected === undefined && "bg-accent font-medium",
        )}
      >
        <span>
          All features <span className="text-muted-foreground">· {rows.length}</span>
        </span>
        <TallyLine tally={tally(rows)} />
      </a>
      {featureTree(rows).map((node) => (
        // The project is in the key: a stored flag is read once per mounted branch.
        <Branch
          key={`${project ?? ""}:${node.path}`}
          node={node}
          project={project}
          selected={selected}
          state={state}
          depth={0}
        />
      ))}
    </nav>
  );
}

function TallyLine({ tally: counted }: { tally: Tally }) {
  return (
    <span className="font-normal text-[11px] text-muted-foreground leading-4">
      {tallyLine(counted)}
    </span>
  );
}

type BranchProps = {
  node: Node;
  project?: string;
  selected?: string;
  state?: string;
  depth: number;
};

function Branch(props: BranchProps) {
  const { node, depth } = props;
  // The link is stretched over the whole row (indent included), as before the
  // chevron existed; the chevron sits above it and is the only part that does not navigate.
  const row = (marker: React.ReactNode) => (
    <div
      className={cn(
        "relative flex items-start gap-0.5 rounded-md pr-2 hover:bg-accent",
        props.selected === node.path && "bg-accent font-medium",
      )}
      style={{ paddingLeft: `${0.25 + depth}rem` }}
    >
      {marker}
      <a
        href={formatRoute({
          view: "cases",
          project: props.project,
          feature: node.path,
          state: props.state,
        })}
        className="flex min-w-0 flex-1 flex-col py-1 after:absolute after:inset-0 after:rounded-md"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-muted-foreground text-xs">{node.count}</span>
        </span>
        <TallyLine tally={node.tally} />
      </a>
    </div>
  );
  if (node.children.length === 0) {
    return row(
      <span className="mt-1 flex size-5 shrink-0 items-center justify-center">
        <Folder className="size-3.5 text-muted-foreground" />
      </span>,
    );
  }
  return <Parent {...props} row={row} />;
}

function Parent(props: BranchProps & { row: (marker: React.ReactNode) => React.ReactNode }) {
  const { node, project, selected, state, depth, row } = props;
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
            "relative z-10 mt-1 flex size-5 shrink-0 items-center justify-center rounded-sm",
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
            state={state}
            depth={depth + 1}
          />
        ))}
      </div>
    </>
  );
}
