import { Link2, Paperclip, RotateCw, X } from "lucide-react";
import { type ClipboardEvent, useId, useRef, useState } from "react";
import { type CasefileError, uploadEvidence } from "@/api";
import { formatSize } from "@/components/Evidence";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FieldErrors } from "@/views/CaseFields";

type FileDraft = {
  key: number;
  file: File;
  label: string;
  /** The id `run` names it by, once the server staged it. */
  upload: string | null;
  state: "uploading" | "ready" | "failed";
  errors: CasefileError[];
};
type LinkDraft = { key: number; url: string; label: string };

/** One `attach` entry of `run`, and the file or link it came from. */
type Attachment = { key: number; entry: { upload: string } | { url: string }; label: string };

/**
 * The evidence a result carries while it is written (ADR run-evidence-files
 * §6): files upload as soon as they are added, so the limits' errors show next
 * to each before the result is sent; links are kept as typed.
 */
export function useEvidenceDraft() {
  const [files, setFiles] = useState<FileDraft[]>([]);
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const next = useRef(0);

  const patch = (key: number, change: Partial<FileDraft>) =>
    setFiles((all) => all.map((f) => (f.key === key ? { ...f, ...change } : f)));

  const send = async (key: number, file: File) => {
    patch(key, { state: "uploading", errors: [], upload: null });
    const result = await uploadEvidence(file);
    patch(
      key,
      result.ok
        ? { state: "ready", upload: result.value.upload }
        : { state: "failed", errors: result.errors },
    );
  };

  return {
    files,
    links,
    addFiles(added: readonly File[]) {
      const drafts = added.map(
        (file): FileDraft => ({
          key: next.current++,
          file,
          label: "",
          upload: null,
          state: "uploading",
          errors: [],
        }),
      );
      setFiles((all) => [...all, ...drafts]);
      for (const draft of drafts) void send(draft.key, draft.file);
    },
    retry(key: number) {
      const draft = files.find((f) => f.key === key);
      if (draft !== undefined) void send(key, draft.file);
    },
    removeFile: (key: number) => setFiles((all) => all.filter((f) => f.key !== key)),
    labelFile: (key: number, label: string) => patch(key, { label }),
    addLink(): number {
      const key = next.current++;
      setLinks((all) => [...all, { key, url: "", label: "" }]);
      return key;
    },
    setLink: (key: number, change: Partial<LinkDraft>) =>
      setLinks((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l))),
    removeLink: (key: number) => setLinks((all) => all.filter((l) => l.key !== key)),
    /** A file `run` cannot use yet: still uploading, or refused. */
    blocked(): CasefileError | null {
      if (files.some((f) => f.state === "uploading")) {
        return { code: "ui.uploading", message: "Wait until every file is uploaded." };
      }
      if (files.some((f) => f.state === "failed")) {
        return {
          code: "ui.upload_failed",
          message: "A file could not be uploaded: remove it or try again.",
        };
      }
      return null;
    },
    /** `run`'s `attach`: the files, then the links with a URL, labels trimmed. */
    attachments(): Attachment[] {
      return [
        ...files.flatMap((f) =>
          f.upload === null ? [] : [{ key: f.key, entry: { upload: f.upload }, label: f.label }],
        ),
        ...links.flatMap((l) =>
          l.url.trim() === "" ? [] : [{ key: l.key, entry: { url: l.url.trim() }, label: l.label }],
        ),
      ];
    },
    /** A refused upload id (expired, or gone with an earlier result) is uploaded again by Retry. */
    refused(keys: readonly number[], errors: readonly CasefileError[]) {
      for (const [i, key] of keys.entries()) {
        const gone = errors.filter(
          (e) => e.code === "ui.upload_unknown" && e.field === `attach.${i}`,
        );
        if (gone.length > 0) patch(key, { state: "failed", upload: null, errors: [] });
      }
    },
  };
}

export type EvidenceDraft = ReturnType<typeof useEvidenceDraft>;

/** `[{ upload | url, label? }]` as `run` takes it. */
export function attachInput(attachments: readonly Attachment[]) {
  return attachments.map(({ entry, label }) =>
    label.trim() === "" ? entry : { ...entry, label: label.trim() },
  );
}

/**
 * The form's evidence: a drop zone with a file picker (pasting an image
 * anywhere in the form adds it too, see `pastedFiles`), each file with its
 * name, size, label and errors, and the links with theirs. `errorsOf` answers
 * the errors `run` placed on an entry.
 */
export function EvidenceFields({
  draft,
  errorsOf,
}: {
  draft: EvidenceDraft;
  errorsOf: (key: number) => CasefileError[];
}) {
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const focusLink = useRef<number | null>(null);
  const [over, setOver] = useState(false);

  return (
    <FieldSet>
      <FieldLegend variant="label">Evidence</FieldLegend>
      <FieldDescription>
        Optional. Screenshots, videos, logs and links; the files are committed with the result.
      </FieldDescription>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the button picks the same files */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          draft.addFiles([...e.dataTransfer.files]);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm",
          over && "border-primary bg-accent",
        )}
      >
        <p>Drop files here, or paste an image with Ctrl/Cmd+V.</p>
        <Button
          ref={choose}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => picker.current?.click()}
        >
          <Paperclip /> Choose files
        </Button>
        <input
          ref={picker}
          id={`${id}-files`}
          type="file"
          multiple
          tabIndex={-1}
          aria-label="Evidence files"
          className="sr-only"
          onChange={(e) => {
            draft.addFiles([...(e.target.files ?? [])]);
            // The same file can be picked again after it is removed.
            e.target.value = "";
          }}
        />
      </div>

      {draft.files.length === 0 ? null : (
        <ul aria-label="Files" className="flex flex-col gap-2">
          {draft.files.map((f) => {
            // Once uploaded again, the earlier "unknown upload" no longer applies.
            const errors = [
              ...f.errors,
              ...errorsOf(f.key).filter(
                (e) => f.state === "failed" || e.code !== "ui.upload_unknown",
              ),
            ];
            const labelId = `${id}-file-${f.key}`;
            return (
              <li
                key={f.key}
                data-invalid={errors.length > 0 || undefined}
                className="flex flex-col gap-2 rounded-md border p-2 data-[invalid=true]:border-destructive"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="break-all font-medium">{f.file.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatSize(f.file.size)}
                  </span>
                  <span className="text-muted-foreground text-xs" aria-live="polite">
                    {f.state === "uploading" ? "Uploading…" : f.state === "ready" ? "Uploaded" : ""}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {f.state === "failed" && !refusedForGood(errors) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => draft.retry(f.key)}
                      >
                        <RotateCw /> Upload again
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${f.file.name}`}
                      onClick={() => {
                        draft.removeFile(f.key);
                        choose.current?.focus();
                      }}
                    >
                      <X />
                    </Button>
                  </span>
                </div>
                <Input
                  id={labelId}
                  value={f.label}
                  placeholder="Label (optional)"
                  aria-label={`Label of ${f.file.name}`}
                  aria-invalid={errors.some((e) => e.field?.endsWith(".label")) || undefined}
                  onChange={(e) => draft.labelFile(f.key, e.target.value)}
                />
                <FieldErrors errors={errors} />
              </li>
            );
          })}
        </ul>
      )}

      {draft.links.length === 0 ? null : (
        <ul aria-label="Links" className="flex flex-col gap-2">
          {draft.links.map((l, i) => {
            const errors = errorsOf(l.key);
            return (
              <li
                key={l.key}
                className="grid items-start gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
              >
                <Input
                  ref={(input) => {
                    if (input !== null && focusLink.current === l.key) {
                      focusLink.current = null;
                      input.focus();
                    }
                  }}
                  inputMode="url"
                  value={l.url}
                  placeholder="https://…"
                  aria-label={`Link ${i + 1} URL`}
                  aria-invalid={errors.length > 0 || undefined}
                  onChange={(e) => draft.setLink(l.key, { url: e.target.value })}
                />
                <Input
                  value={l.label}
                  placeholder="Label (optional)"
                  aria-label={`Link ${i + 1} label`}
                  onChange={(e) => draft.setLink(l.key, { label: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove link ${i + 1}`}
                  onClick={() => draft.removeLink(l.key)}
                >
                  <X />
                </Button>
                {errors.length === 0 ? null : (
                  <div className="sm:col-span-3">
                    <FieldErrors errors={errors} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            focusLink.current = draft.addLink();
          }}
        >
          <Link2 /> Add a link
        </Button>
      </div>
    </FieldSet>
  );
}

/** A file the workspace's limits refuse (type, size): uploading it again fails the same way. */
function refusedForGood(errors: readonly CasefileError[]): boolean {
  return errors.some((e) => e.code.startsWith("evidence."));
}

/** The files a paste carries (an image copied to the clipboard); none for pasted text. */
export function pastedFiles(event: ClipboardEvent): File[] {
  return [...(event.clipboardData?.files ?? [])];
}
