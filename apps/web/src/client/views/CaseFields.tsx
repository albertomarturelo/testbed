import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { CasefileError } from "@/api";
import { Button } from "@/components/ui/button";
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

export type LabelValue = string | number | boolean | string[];
export type StepRow = { key: number; do: string; expect: string; rest: Record<string, unknown> };
export type ItemRow = { key: number; text: string };
export type LabelRow = { key: number; name: string; text: string; was?: LabelValue };
/** A value the case gets from a commons file: shown, not edited, never sent. */
export type FromCommons = { field: string; text: string; origin: string };

/** The values a case form edits, as text; `rest` keeps a step's other keys (`evidence`). */
export type Draft = {
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
export const rowKey = () => ++lastKey;

export const emptyStep = (): StepRow => ({ key: rowKey(), do: "", expect: "", rest: {} });

/**
 * The fields a QA writes on a case (#92, #94), shared by the editor (`review`)
 * and the new-case form (`cover`). `errors` are the operation's errors placed
 * by `placeErrors` with the same `prefix` the operation names its input with.
 */
export function CaseFields({
  draft,
  update,
  errors,
  prefix,
  fromCommons = [],
}: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  errors: Map<string, CasefileError[]>;
  /** Where the case sits in the operation's input: `set` for `review`, `cases.0` for `cover`. */
  prefix: string;
  fromCommons?: readonly FromCommons[];
}) {
  const at = (key: string) => errors.get(key) ?? [];
  /** Whether the operation refused this input of step `i` (`<prefix>.steps.<i>.do` / `.expect`). */
  const stepInvalid = (i: number, part: "do" | "expect") =>
    at(`steps.${i}`).some((e) => e.field === `${prefix}.steps.${i}.${part}`) || undefined;

  return (
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
          onClick={() => update({ steps: [...draft.steps, emptyStep()] })}
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
        <Inherited items={fromCommons.filter((v) => v.field.startsWith("labels."))} noun="label" />
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
export function FieldErrors({ errors }: { errors: readonly CasefileError[] }) {
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

/** Label rows as the case stores them: a value keeps the type it was loaded with. */
export function labelsOf(rows: readonly LabelRow[]): Record<string, LabelValue> {
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
 * Splits an operation's errors into the ones a form field owns
 * (`<prefix>.<field>…`, keyed `title`, `steps.<i>`, `labels.<key>`, …) and the
 * rest, shown whole.
 */
export function placeErrors(
  errors: readonly CasefileError[],
  prefix: string,
): { byField: Map<string, CasefileError[]>; rest: CasefileError[] } {
  const byField = new Map<string, CasefileError[]>();
  const rest: CasefileError[] = [];
  for (const error of errors) {
    const key = fieldKey(error.field, prefix);
    if (key === null) {
      rest.push(error);
      continue;
    }
    byField.set(key, [...(byField.get(key) ?? []), error]);
  }
  return { byField, rest };
}

const FIELDS = new Set(["title", "priority", "preconditions", "steps", "labels", "automation"]);

function fieldKey(field: string | undefined, prefix: string): string | null {
  if (field === undefined || !field.startsWith(`${prefix}.`)) return null;
  const [name, second] = field.slice(prefix.length + 1).split(".");
  if (name === undefined || !FIELDS.has(name)) return null;
  if (second === undefined || name === "automation") return name;
  return `${name}.${second}`;
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
