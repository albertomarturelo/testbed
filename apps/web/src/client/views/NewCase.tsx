import { ArrowLeft } from "lucide-react";
import { type FormEvent, useState } from "react";
import { type CasefileError, type Covered, call } from "@/api";
import { ErrorList } from "@/components/ErrorList";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatRoute } from "@/route";
import {
  CaseFields,
  type Draft,
  emptyStep,
  FieldErrors,
  labelsOf,
  placeErrors,
} from "@/views/CaseFields";
import { TicketField, ticketErrors, useTicket } from "@/views/TicketField";

/** Where `cover` names the one case the form sends. */
const PREFIX = "cases.0";

/**
 * A new case, written by the QA (#94, ADR human-writes-through-operations):
 * the editor's fields over one `cover` call with only what was filled. Core
 * gives it its id, `state: draft`, `origin: human` and its history, as for an
 * agent's draft; the viewer commits it as the QA. `project` and `feature` come
 * from the list the QA was on; a feature can be typed as a new slug.
 */
export function NewCase({
  projects,
  features,
  project: initialProject,
  feature: initialFeature,
  onCreated,
}: {
  /** Every project of the workspace: one to choose from when the list showed them all. */
  projects: readonly string[];
  /** The features that already have cases, per project, offered as you type. */
  features: ReadonlyMap<string, readonly string[]>;
  project?: string;
  feature?: string;
  onCreated: (covered: Covered) => void;
}) {
  const [project, setProject] = useState(
    initialProject ?? (projects.length === 1 ? projects[0] : undefined) ?? "",
  );
  const [feature, setFeature] = useState(initialFeature ?? "");
  const [draft, setDraft] = useState<Draft>(() => ({
    title: "",
    priority: "",
    preconditions: [],
    steps: [emptyStep()],
    labels: [],
    eligible: false,
    automationRef: "",
  }));
  const [errors, setErrors] = useState<CasefileError[]>([]);
  const [saving, setSaving] = useState(false);
  const ticket = useTicket();

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const back = formatRoute({
    view: "cases",
    project: initialProject,
    feature: initialFeature,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const missing: CasefileError[] = [];
    if (project === "") {
      missing.push({ code: "ui.required", field: "project", message: "Choose a project." });
    }
    if (feature.trim() === "") {
      missing.push({ code: "ui.required", field: "feature", message: "Name the feature." });
    }
    if (missing.length > 0) {
      setErrors(missing);
      return;
    }
    setSaving(true);
    const result = await call<Covered>("cover", {
      project,
      feature: feature.trim(),
      cases: [proposed(draft)],
      ...ticket.input(),
    });
    setSaving(false);
    if (result.ok) onCreated(result.value);
    else setErrors(result.errors);
  };

  const ticketed = ticketErrors(errors);
  const placed = placeErrors(ticketed.rest, PREFIX);
  const at = (name: "project" | "feature") => placed.rest.filter((e) => e.field === name);
  const rest = placed.rest.filter((e) => e.field !== "project" && e.field !== "feature");
  const choose = initialProject === undefined && projects.length > 1;
  const known = features.get(project) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <a
        href={back}
        className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Cases
      </a>
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">New case</h1>
        <p className="text-muted-foreground text-sm">
          It is created as a draft and committed as you; approve it from its page.
        </p>
      </header>
      <form onSubmit={submit} aria-label="New case" className="flex flex-col gap-4">
        {rest.length === 0 ? null : <ErrorList errors={rest} />}
        <Card className="min-w-0">
          <CardContent className="flex flex-col gap-6">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {choose ? (
                <Field data-invalid={at("project").length > 0 || undefined}>
                  <FieldLabel htmlFor="case-project">Project</FieldLabel>
                  <NativeSelect
                    id="case-project"
                    value={project}
                    aria-invalid={at("project").length > 0 || undefined}
                    onChange={(e) => setProject(e.target.value)}
                  >
                    <NativeSelectOption value="">Choose…</NativeSelectOption>
                    {projects.map((name) => (
                      <NativeSelectOption key={name} value={name}>
                        {name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldErrors errors={at("project")} />
                </Field>
              ) : null}
              <Field data-invalid={at("feature").length > 0 || undefined}>
                <FieldLabel htmlFor="case-feature">Feature</FieldLabel>
                <Input
                  id="case-feature"
                  className="font-mono"
                  placeholder="checkout/payment"
                  list="case-features"
                  value={feature}
                  aria-invalid={at("feature").length > 0 || undefined}
                  onChange={(e) => setFeature(e.target.value)}
                />
                <datalist id="case-features">
                  {known.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <FieldDescription>
                  Lowercase words joined by <span className="font-mono">-</span>, nested with{" "}
                  <span className="font-mono">/</span>. A new one becomes a folder.
                </FieldDescription>
                <FieldErrors errors={at("feature")} />
              </Field>
            </FieldGroup>
            <CaseFields
              draft={draft}
              update={update}
              errors={placed.byField}
              prefix={PREFIX}
              eligibleHint="Left unticked, the feature's commons decide: a _common.yaml may make it eligible."
            />
            <TicketField ticket={ticket} errors={ticketed.ticket} />
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
          <Button asChild variant="outline">
            <a href={back}>Cancel</a>
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * The case `cover` gets: what the form has, without what was left empty. Steps
 * are sent as typed, so an empty one is refused on its field, not dropped.
 */
function proposed(draft: Draft): Record<string, unknown> {
  const c: Record<string, unknown> = {
    title: draft.title,
    steps: draft.steps.map((row) => ({ do: row.do, expect: row.expect })),
  };
  if (draft.priority !== "") c.priority = draft.priority;
  const preconditions = draft.preconditions.map((row) => row.text.trim()).filter((t) => t !== "");
  if (preconditions.length > 0) c.preconditions = preconditions;
  const labels = labelsOf(draft.labels);
  if (Object.keys(labels).length > 0) c.labels = labels;
  const ref = draft.automationRef.trim();
  if (draft.eligible || ref !== "") {
    c.automation = { ...(draft.eligible ? { eligible: true } : {}), ...(ref ? { ref } : {}) };
  }
  return c;
}
