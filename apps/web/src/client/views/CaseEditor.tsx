import { type FormEvent, useState } from "react";
import { type CasefileError, call, type Resolved, type Reviewed } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CaseFields,
  type Draft,
  type FromCommons,
  type ItemRow,
  type LabelRow,
  type LabelValue,
  labelsOf,
  placeErrors,
  rowKey,
} from "@/views/CaseFields";

/**
 * The case page in edit mode (#92, ADR human-writes-through-operations): the
 * fields a QA reviews, as a form. "Save" calls `review` once, with only what
 * changed and the last change read as `base`; an error on a field shows under
 * it, any other error shows whole above the form.
 */
export function CaseEditor({
  resolved,
  onSaved,
  onCancel,
}: {
  resolved: Resolved;
  onSaved: (reviewed: Reviewed) => void;
  onCancel: () => void;
}) {
  const [{ initial, fromCommons }] = useState(() => split(resolved));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<CasefileError[]>([]);
  const [saving, setSaving] = useState(false);
  const [unchanged, setUnchanged] = useState(false);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setUnchanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const set = changes(initial, draft);
    if (Object.keys(set).length === 0) {
      setErrors([]);
      setUnchanged(true);
      return;
    }
    setSaving(true);
    const base = lastChange(resolved.case);
    const result = await call<Reviewed>("review", {
      ref: resolved.ref,
      set,
      ...(base === undefined ? {} : { base }),
    });
    setSaving(false);
    if (result.ok) onSaved(result.value);
    else setErrors(result.errors);
  };

  const placed = placeErrors(errors, "set");

  return (
    <form onSubmit={submit} aria-label="Edit case" className="flex flex-col gap-4">
      {placed.rest.length === 0 ? null : <ErrorList errors={placed.rest} />}
      <Card className="min-w-0">
        <CardContent>
          <CaseFields
            draft={draft}
            update={update}
            errors={placed.byField}
            prefix="set"
            fromCommons={fromCommons}
          />
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        {unchanged ? (
          <p role="status" className="text-muted-foreground text-sm">
            Nothing changed.
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** The origin `resolve` gives a value the case file sets itself. */
const CASE_ORIGIN = "(the case)";

/**
 * The form's starting values and what the case inherits. `resolve` prepends
 * commons preconditions and merges commons labels per key: the form edits only
 * the case's own, or a save would copy the inherited ones into the file.
 */
function split(resolved: Resolved): { initial: Draft; fromCommons: FromCommons[] } {
  const c = resolved.case;
  const origins = new Map(resolved.inherited.map((row) => [row.field, row.origin]));
  const inherited = (field: string) => {
    const origin = origins.get(field);
    return origin !== undefined && origin !== CASE_ORIGIN ? origin : null;
  };
  const fromCommons: FromCommons[] = [];
  const preconditions: ItemRow[] = [];
  (Array.isArray(c.preconditions) ? (c.preconditions as string[]) : []).forEach((text, i) => {
    const origin = inherited(`preconditions.${i}`);
    if (origin === null) preconditions.push({ key: rowKey(), text });
    else fromCommons.push({ field: `preconditions.${i}`, text, origin });
  });
  const labels: LabelRow[] = [];
  const stored = isRecord(c.labels) ? (c.labels as Record<string, LabelValue>) : {};
  for (const [name, was] of Object.entries(stored)) {
    const text = Array.isArray(was) ? was.join(", ") : String(was);
    const origin = inherited(`labels.${name}`);
    if (origin === null) labels.push({ key: rowKey(), name, text, was });
    else fromCommons.push({ field: `labels.${name}`, text: `${name}: ${text}`, origin });
  }
  return { initial: draftOf(c, preconditions, labels), fromCommons };
}

function draftOf(c: Record<string, unknown>, preconditions: ItemRow[], labels: LabelRow[]): Draft {
  const automation = (c.automation ?? {}) as { eligible?: boolean; ref?: string };
  return {
    title: String(c.title ?? ""),
    priority: typeof c.priority === "string" ? c.priority : "",
    preconditions,
    steps: (Array.isArray(c.steps) ? (c.steps as Record<string, unknown>[]) : []).map(
      ({ do: action, expect, ...rest }) => ({
        key: rowKey(),
        do: String(action ?? ""),
        expect: String(expect ?? ""),
        rest,
      }),
    ),
    labels,
    eligible: automation.eligible ?? false,
    automationRef: automation.ref ?? "",
  };
}

/**
 * The `set` of a `review` call: only the fields whose value differs from what
 * the page loaded. An emptied list is `null`, so the case inherits it again.
 */
function changes(initial: Draft, draft: Draft): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (draft.title !== initial.title) set.title = draft.title;
  if (draft.priority !== initial.priority && draft.priority !== "") set.priority = draft.priority;

  const preconditions = draft.preconditions.map((row) => row.text.trim()).filter((t) => t !== "");
  if (
    !same(
      preconditions,
      initial.preconditions.map((row) => row.text),
    )
  ) {
    set.preconditions = preconditions.length === 0 ? null : preconditions;
  }

  const steps = draft.steps.map((row) => ({ do: row.do, expect: row.expect, ...row.rest }));
  const initialSteps = initial.steps.map((row) => ({
    do: row.do,
    expect: row.expect,
    ...row.rest,
  }));
  if (!same(steps, initialSteps)) set.steps = steps;

  const labels = labelsOf(draft.labels);
  if (!same(labels, labelsOf(initial.labels))) {
    set.labels = Object.keys(labels).length === 0 ? null : labels;
  }

  const automation: Record<string, unknown> = {};
  if (draft.eligible !== initial.eligible) automation.eligible = draft.eligible;
  const ref = draft.automationRef.trim();
  if (ref !== initial.automationRef) automation.ref = ref === "" ? null : ref;
  if (Object.keys(automation).length > 0) set.automation = automation;
  return set;
}

function lastChange(c: Record<string, unknown>): string | undefined {
  const history = Array.isArray(c.history) ? (c.history as { change?: string }[]) : [];
  return history.at(-1)?.change;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
