import { type FormEvent, useId, useState } from "react";
import { type CasefileError, call, type Recorded } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FieldErrors } from "@/views/CaseFields";
import { TicketField, ticketErrors, useTicket } from "@/views/TicketField";

/** The results `run` accepts (`casefile spec run`). */
const STATUSES = ["passed", "failed", "blocked", "skipped"] as const;

/** The inputs of `run` the form has; an error naming one shows under it. */
const INPUTS = ["status", "note", "env", "build", "milestone"] as const;
type InputName = (typeof INPUTS)[number];

/**
 * The form that records what happened when the QA executed the case by hand
 * (#93, ADR human-writes-through-operations): one `run` call with the result
 * and only the optional fields the QA filled. Nothing is preselected: a result
 * is something that happened, not a default. casefile runs nothing.
 */
export function RunRecorder({
  caseRef,
  onRecorded,
  onCancel,
}: {
  caseRef: string;
  onRecorded: (recorded: Recorded) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [status, setStatus] = useState("");
  const [text, setText] = useState({ note: "", env: "", build: "", milestone: "" });
  const [errors, setErrors] = useState<CasefileError[]>([]);
  const [saving, setSaving] = useState(false);
  const ticket = useTicket();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === "") {
      setErrors([{ code: "ui.required", field: "status", message: "Choose what happened." }]);
      return;
    }
    const filled = Object.fromEntries(
      Object.entries(text)
        // A note keeps its lines; only the blank edges go.
        .map(([name, value]) => [name, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    setSaving(true);
    const result = await call<Recorded>("run", {
      ref: caseRef,
      status,
      ...filled,
      ...ticket.input(),
    });
    setSaving(false);
    if (result.ok) onRecorded(result.value);
    else setErrors(result.errors);
  };

  const at = (name: InputName) => errors.filter((e) => e.field === name);
  const placed = ticketErrors(errors);
  const rest = placed.rest.filter((e) => !INPUTS.includes(e.field as InputName));
  const invalid = (name: InputName) => at(name).length > 0 || undefined;
  const line = (name: "env" | "build" | "milestone", label: string, hint: string) => (
    <Field data-invalid={invalid(name)}>
      <FieldLabel htmlFor={`${id}-${name}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${name}`}
        value={text[name]}
        placeholder={hint}
        aria-invalid={invalid(name)}
        onChange={(e) => setText((t) => ({ ...t, [name]: e.target.value }))}
      />
      <FieldErrors errors={at(name)} />
    </Field>
  );

  return (
    <form onSubmit={submit} aria-label="Record a result" className="flex flex-col gap-4">
      {rest.length === 0 ? null : <ErrorList errors={rest} />}
      <FieldGroup>
        <Field data-invalid={invalid("status")}>
          <FieldLabel htmlFor={`${id}-status`}>Result</FieldLabel>
          <NativeSelect
            id={`${id}-status`}
            value={status}
            aria-invalid={invalid("status")}
            onChange={(e) => {
              setStatus(e.target.value);
              setErrors((all) => all.filter((error) => error.field !== "status"));
            }}
          >
            <NativeSelectOption value="">Choose…</NativeSelectOption>
            {STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {s}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>
            Blocked means a step could not be done; failed means it was done and the result was
            wrong.
          </FieldDescription>
          <FieldErrors errors={at("status")} />
        </Field>
        <Field data-invalid={invalid("note")}>
          <FieldLabel htmlFor={`${id}-note`}>Note</FieldLabel>
          <Textarea
            id={`${id}-note`}
            rows={3}
            value={text.note}
            aria-invalid={invalid("note")}
            onChange={(e) => setText((t) => ({ ...t, note: e.target.value }))}
          />
          <FieldDescription>
            Optional. What you saw: why it failed, what blocked it.
          </FieldDescription>
          <FieldErrors errors={at("note")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          {line("env", "Environment", "staging")}
          {line("build", "Build", "web-2.1.0+9")}
          {line("milestone", "Milestone", "web-2.1.0")}
        </div>
        <TicketField ticket={ticket} errors={placed.ticket} />
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Recording…" : "Record"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
