import { type FormEvent, useEffect, useId, useState } from "react";
import { type CasefileError, call, type MilestoneList, type Recorded, type Result } from "@/api";
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
 * and only the optional fields the QA filled. No result is preselected: a
 * result is something that happened, not a default. The milestone is one of
 * the project's open ones or none (#166): never typed, so a typo cannot split
 * one. casefile runs nothing.
 */
export function RunRecorder({
  caseRef,
  milestone = "",
  onRecorded,
  onCancel,
}: {
  caseRef: string;
  /** The milestone the case was opened from (its page is behind): chosen to start with. */
  milestone?: string;
  onRecorded: (recorded: Recorded) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [status, setStatus] = useState("");
  const [text, setText] = useState({ note: "", env: "", build: "", milestone });
  const open = useOpenMilestones(caseRef);
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
  const line = (name: "env" | "build", label: string, hint: string) => (
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
          <Field data-invalid={invalid("milestone")}>
            <FieldLabel htmlFor={`${id}-milestone`}>Milestone</FieldLabel>
            <NativeSelect
              id={`${id}-milestone`}
              value={text.milestone}
              aria-invalid={invalid("milestone")}
              disabled={open === null}
              onChange={(e) => setText((t) => ({ ...t, milestone: e.target.value }))}
            >
              <NativeSelectOption value="">None</NativeSelectOption>
              {/* The one asked for stays listed while the list loads or if it closed meanwhile: core says why. */}
              {text.milestone !== "" &&
              !(open?.ok && open.value.some((m) => m.slug === text.milestone)) ? (
                <NativeSelectOption value={text.milestone}>{text.milestone}</NativeSelectOption>
              ) : null}
              {open?.ok
                ? open.value.map((m) => (
                    <NativeSelectOption key={m.slug} value={m.slug}>
                      {m.title === m.slug ? m.slug : `${m.title} (${m.slug})`}
                    </NativeSelectOption>
                  ))
                : null}
            </NativeSelect>
            {open !== null && !open.ok ? (
              <FieldDescription>
                Could not list milestones: {open.errors.map((e) => e.message).join("; ")}
              </FieldDescription>
            ) : open?.ok && open.value.length === 0 ? (
              <FieldDescription>No open milestone in this project.</FieldDescription>
            ) : null}
            <FieldErrors errors={at("milestone")} />
          </Field>
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

/** The open milestones of the case's project; `null` while loading. */
function useOpenMilestones(caseRef: string): Result<{ slug: string; title: string }[]> | null {
  const project = caseRef.includes("/") ? caseRef.split("/")[0] : undefined;
  const [result, setResult] = useState<Result<{ slug: string; title: string }[]> | null>(null);
  useEffect(() => {
    let current = true;
    call<MilestoneList>("milestone-list", {
      open: true,
      ...(project === undefined ? {} : { project }),
    }).then((r) => {
      if (!current) return;
      setResult(
        r.ok
          ? {
              ok: true,
              value: r.value.milestones
                .filter((m) => project === undefined || m.project === project)
                .map(({ slug, title }) => ({ slug, title })),
            }
          : r,
      );
    });
    return () => {
      current = false;
    };
  }, [project]);
  return result;
}
