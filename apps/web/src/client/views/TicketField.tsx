import { useEffect, useId, useState } from "react";
import { type CasefileError, type SessionCommit, session } from "@/api";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FieldErrors } from "@/views/CaseFields";

/** What the QA typed, for this tab only: a ticket belongs to the task at hand. */
const KEY = "casefile.commit.ticket";

/**
 * The ticket for the commit subject (ADR commit-shape-follows-host-repo §3,
 * #158). `needed` when `commit.subject` names `{ticket}`; the value starts as
 * what the QA typed earlier in this tab, else what the branch names. `input()`
 * is spread into the write: `{ ticket }` only when filled.
 */
export function useTicket(): {
  needed: boolean;
  value: string;
  setValue: (value: string) => void;
  input: () => { ticket?: string };
} {
  const [commit, setCommit] = useState<SessionCommit | undefined>();
  const [typed, setTyped] = useState<string | null>(readTyped);
  useEffect(() => {
    let current = true;
    session().then((s) => current && setCommit(s?.commit));
    return () => {
      current = false;
    };
  }, []);
  const needed = commit?.ticket === true;
  const value = typed ?? commit?.branchTicket ?? "";
  const setValue = (next: string) => {
    setTyped(next);
    try {
      window.sessionStorage.setItem(KEY, next);
    } catch {
      // Not kept this time; the form works the same.
    }
  };
  const input = () => {
    const ticket = value.trim();
    return needed && ticket !== "" ? { ticket } : {};
  };
  return { needed, value, setValue, input };
}

function readTyped(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The errors about the ticket, and the rest: a form shows the first under the field. */
export function ticketErrors(errors: readonly CasefileError[]): {
  ticket: CasefileError[];
  rest: CasefileError[];
} {
  return {
    ticket: errors.filter((e) => e.field === "ticket"),
    rest: errors.filter((e) => e.field !== "ticket"),
  };
}

/** The field itself, shown only when the subject template needs a ticket. */
export function TicketField({
  ticket,
  errors,
}: {
  ticket: ReturnType<typeof useTicket>;
  errors: readonly CasefileError[];
}) {
  const id = useId();
  if (!ticket.needed) return null;
  const invalid = errors.length > 0 || undefined;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={`${id}-ticket`}>Ticket</FieldLabel>
      <Input
        id={`${id}-ticket`}
        value={ticket.value}
        placeholder="PROJ-123"
        aria-invalid={invalid}
        onChange={(e) => ticket.setValue(e.target.value)}
      />
      <FieldDescription>
        Goes in the commit subject, as this repository asks. Kept while this tab is open.
      </FieldDescription>
      <FieldErrors errors={errors} />
    </Field>
  );
}
