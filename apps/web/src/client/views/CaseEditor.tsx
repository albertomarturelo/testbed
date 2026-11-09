import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { type CasefileError, call, type Resolved, type Reviewed } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

type LabelValue = string | number | boolean | string[];
type StepRow = { key: number; do: string; expect: string; rest: Record<string, unknown> };
type ItemRow = { key: number; text: string };
type LabelRow = { key: number; name: string; text: string; was?: LabelValue };
/** A value the case gets from a commons file: shown, not edited, never sent. */
type FromCommons = { field: string; text: string; origin: string };

/** The values the form edits, as text; `rest` keeps a step's other keys (`evidence`). */
type Draft = {
  title: string;
  priority: string;
  preconditions: ItemRow[];
  steps: StepRow[];
  labels: LabelRow[];
  eligible: boolean;
  automationRef: string;
};

let lastKey = 0;
/** A stable React key for a row the QA can move or remove. */
const rowKey = () => ++lastKey;

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

  const placed = placeErrors(errors);
  const at = (key: string) => placed.byField.get(key) ?? [];
  /** Whether `review` refused this input of step `i` (`set.steps.<i>.do` / `.expect`). */
  const stepInvalid = (i: number, part: "do" | "expect") =>
    at(`steps.${i}`).some((e) => e.field === `set.steps.${i}.${part}`) || undefined;

  return (
    <form onSubmit={submit} aria-label="Edit case" className="flex flex-col gap-4">
      {placed.rest.length === 0 ? null : <ErrorList errors={placed.rest} />}
      <Card className="min-w-0">
        <CardContent>
          <FieldGroup>
            <Field data-invalid={at("title").length > 0 || undefined}>
              <FieldLabel htmlFor="case-title">Title</FieldLabel>
              <Input
                id="case-title"
                value={draft.title}
                aria-invalid={at("title").length > 0 || undefined}
                onChange={(e) => update({ title: e.target.value })}
              />
              <FieldErrors errors={at("title")} />
            </Field>

            <Field data-invalid={at("priority").length > 0 || undefined}>
              <FieldLabel htmlFor="case-priority">Priority</FieldLabel>
              <NativeSelect
                id="case-priority"
                value={draft.priority}
                aria-invalid={at("priority").length > 0 || undefined}
                onChange={(e) => update({ priority: e.target.value })}
              >
                {draft.priority === "" ? <NativeSelectOption value="">—</NativeSelectOption> : null}
                {PRIORITIES.map((p) => (
                  <NativeSelectOption key={p} value={p}>
                    {p}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldErrors errors={at("priority")} />
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Preconditions</FieldLegend>
              <Inherited
                items={fromCommons.filter((v) => v.field.startsWith("preconditions."))}
                noun="precondition"
              />
              <ol className="flex flex-col gap-2">
                {draft.preconditions.map((row, i) => (
                  <li key={row.key} className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <Input
                        aria-label={`Precondition ${i + 1}`}
                        value={row.text}
                        aria-invalid={at(`preconditions.${i}`).length > 0 || undefined}
                        onChange={(e) =>
                          update({
                            preconditions: replaceAt(draft.preconditions, i, {
                              ...row,
                              text: e.target.value,
                            }),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove precondition ${i + 1}`}
                        onClick={() => update({ preconditions: removeAt(draft.preconditions, i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <FieldErrors errors={at(`preconditions.${i}`)} />
                  </li>
                ))}
              </ol>
              <FieldErrors errors={at("preconditions")} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  update({ preconditions: [...draft.preconditions, { key: rowKey(), text: "" }] })
                }
              >
                <Plus /> Add precondition
              </Button>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Steps</FieldLegend>
              <ol className="flex flex-col gap-3">
                {draft.steps.map((row, i) => (
                  <li key={row.key} className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-1">
                      <span className="mr-auto font-medium text-muted-foreground text-sm">
                        Step {i + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move step ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => update({ steps: move(draft.steps, i, i - 1) })}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move step ${i + 1} down`}
                        disabled={i === draft.steps.length - 1}
                        onClick={() => update({ steps: move(draft.steps, i, i + 1) })}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove step ${i + 1}`}
                        onClick={() => update({ steps: removeAt(draft.steps, i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Textarea
                        aria-label={`Step ${i + 1} action`}
                        placeholder="Action"
                        value={row.do}
                        aria-invalid={stepInvalid(i, "do")}
                        onChange={(e) =>
                          update({
                            steps: replaceAt(draft.steps, i, { ...row, do: e.target.value }),
                          })
                        }
                      />
                      <Textarea
                        aria-label={`Step ${i + 1} expected result`}
                        placeholder="Expected result"
                        value={row.expect}
                        aria-invalid={stepInvalid(i, "expect")}
                        onChange={(e) =>
                          update({
                            steps: replaceAt(draft.steps, i, { ...row, expect: e.target.value }),
                          })
                        }
                      />
                    </div>
                    <FieldErrors errors={at(`steps.${i}`)} />
                  </li>
                ))}
              </ol>
              <FieldErrors errors={at("steps")} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  update({
                    steps: [...draft.steps, { key: rowKey(), do: "", expect: "", rest: {} }],
                  })
                }
              >
                <Plus /> Add step
              </Button>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Labels</FieldLegend>
              <FieldDescription>
                A list is written comma-separated. Keys are declared in{" "}
                <span className="font-mono text-xs">_properties.yaml</span>.
              </FieldDescription>
              <Inherited
                items={fromCommons.filter((v) => v.field.startsWith("labels."))}
                noun="label"
              />
              <ul className="flex flex-col gap-2">
                {draft.labels.map((row, i) => (
                  <li key={row.key} className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <Input
                        aria-label={`Label ${i + 1} key`}
                        placeholder="key"
                        className="max-w-48 font-mono"
                        value={row.name}
                        aria-invalid={at(`labels.${row.name}`).length > 0 || undefined}
                        onChange={(e) =>
                          update({
                            labels: replaceAt(draft.labels, i, { ...row, name: e.target.value }),
                          })
                        }
                      />
                      <Input
                        aria-label={`Label ${i + 1} value`}
                        placeholder="value"
                        value={row.text}
                        onChange={(e) =>
                          update({
                            labels: replaceAt(draft.labels, i, { ...row, text: e.target.value }),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove label ${i + 1}`}
                        onClick={() => update({ labels: removeAt(draft.labels, i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <FieldErrors errors={at(`labels.${row.name}`)} />
                  </li>
                ))}
              </ul>
              <FieldErrors errors={at("labels")} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  update({ labels: [...draft.labels, { key: rowKey(), name: "", text: "" }] })
                }
              >
                <Plus /> Add label
              </Button>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Automation</FieldLegend>
              <Field orientation="horizontal">
                <input
                  id="case-eligible"
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={draft.eligible}
                  onChange={(e) => update({ eligible: e.target.checked })}
                />
                <FieldLabel htmlFor="case-eligible" className="font-normal">
                  Can be automated
                </FieldLabel>
              </Field>
              <Field data-invalid={at("automation").length > 0 || undefined}>
                <FieldLabel htmlFor="case-automation-ref">Linked test</FieldLabel>
                <Input
                  id="case-automation-ref"
                  className="font-mono"
                  placeholder="login.spec.ts::signs in"
                  value={draft.automationRef}
                  aria-invalid={at("automation").length > 0 || undefined}
                  onChange={(e) => update({ automationRef: e.target.value })}
                />
                <FieldDescription>
                  Whether it is automated or flaky comes from its runs, never from here.
                </FieldDescription>
                <FieldErrors errors={at("automation")} />
              </Field>
            </FieldSet>
          </FieldGroup>
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

/** What the case inherits for a list field, with the file it comes from; edited there, not here. */
function Inherited({ items, noun }: { items: readonly FromCommons[]; noun: string }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label={`Inherited ${noun}s`} className="flex flex-col gap-1 text-sm">
      {items.map((item) => (
        <li key={item.field} className="flex flex-wrap gap-x-2 text-muted-foreground">
          <span>{item.text}</span>
          <span className="font-mono text-xs leading-5">from {item.origin}</span>
        </li>
      ))}
    </ul>
  );
}

/** A field's errors under it, with their code, as the CLI names them. */
function FieldErrors({ errors }: { errors: readonly CasefileError[] }) {
  if (errors.length === 0) return null;
  return (
    <FieldError>
      {errors.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the list is replaced on every save
        <span key={i} className="block">
          <span className="font-mono text-xs">{e.code}</span> {e.message}
        </span>
      ))}
    </FieldError>
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

/** Label rows as the case stores them: a value keeps the type it was loaded with. */
function labelsOf(rows: readonly LabelRow[]): Record<string, LabelValue> {
  const labels: Record<string, LabelValue> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name === "") continue;
    labels[name] = typed(row.text.trim(), row.was);
  }
  return labels;
}

function typed(text: string, was: LabelValue | undefined): LabelValue {
  if (Array.isArray(was)) {
    return text
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  if (typeof was === "number" && text !== "" && Number.isFinite(Number(text))) return Number(text);
  if (typeof was === "boolean" && (text === "true" || text === "false")) return text === "true";
  return text;
}

/**
 * Splits `review`'s errors into the ones a form field owns (`set.<field>…`,
 * keyed `title`, `steps.<i>`, `labels.<key>`, …) and the rest, shown whole.
 */
function placeErrors(errors: readonly CasefileError[]): {
  byField: Map<string, CasefileError[]>;
  rest: CasefileError[];
} {
  const byField = new Map<string, CasefileError[]>();
  const rest: CasefileError[] = [];
  for (const error of errors) {
    const key = fieldKey(error.field);
    if (key === null) {
      rest.push(error);
      continue;
    }
    byField.set(key, [...(byField.get(key) ?? []), error]);
  }
  return { byField, rest };
}

const FIELDS = new Set(["title", "priority", "preconditions", "steps", "labels", "automation"]);

function fieldKey(field: string | undefined): string | null {
  const parts = field?.split(".") ?? [];
  if (parts[0] !== "set" || parts[1] === undefined || !FIELDS.has(parts[1])) return null;
  const [, name, second] = parts;
  if (second === undefined || name === "automation") return name;
  return `${name}.${second}`;
}

function lastChange(c: Record<string, unknown>): string | undefined {
  const history = Array.isArray(c.history) ? (c.history as { change?: string }[]) : [];
  return history.at(-1)?.change;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((current, i) => (i === index ? item : current));
}

function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
