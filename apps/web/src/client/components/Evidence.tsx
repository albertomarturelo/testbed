import { Download, ExternalLink } from "lucide-react";
import { type Evidence, evidenceUrl } from "@/api";

// How a result's evidence reads (ADR run-evidence-files §7): images as
// thumbnails that open full size, videos that play, files to download, links
// that open in a new tab. The server decides what it serves; these only pick
// the element.

/** A URL the page may open: `http:` or `https:` only, whatever a run file says. */
function isWebUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

/** `apps/web/context/tests/.runs/<run>/<case>/1a2b3c4d-shot.png` → `shot.png`. */
export function evidenceName(ref: string): string {
  return (ref.split("/").at(-1) ?? ref).replace(/^[0-9a-f]{8}-/, "");
}

/** `2048` → `2.0 KB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const linkClass =
  "inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A run event's evidence: images and videos first as a row of previews, then files, links and references. */
export function EvidenceList({ evidence }: { evidence: readonly Evidence[] }) {
  const media = evidence.filter((e) => e.kind === "image" || e.kind === "video");
  const rest = evidence.filter((e) => e.kind !== "image" && e.kind !== "video");
  return (
    <div className="flex flex-col gap-2">
      {media.length === 0 ? null : (
        <ul className="flex flex-wrap gap-3">
          {media.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: evidence keeps the order it was attached in
            <li key={i}>
              <MediaPreview item={item} />
            </li>
          ))}
        </ul>
      )}
      {rest.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-xs">
          {rest.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: evidence keeps the order it was attached in
            <li key={i} className="flex flex-wrap items-center gap-x-2">
              <EvidenceLine item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaPreview({ item }: { item: Evidence }) {
  const url = evidenceUrl(item.ref);
  const name = item.label ?? evidenceName(item.ref);
  return (
    <figure className="flex w-40 flex-col gap-1">
      {item.kind === "image" ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${evidenceName(item.ref)} full size`}
          className="block overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <img src={url} alt={name} loading="lazy" className="h-24 w-full object-cover" />
        </a>
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: a recorded screen has no captions to offer
        <video
          src={url}
          controls
          preload="metadata"
          aria-label={name}
          className="h-24 w-full rounded-md border bg-muted"
        />
      )}
      {item.label === undefined ? null : (
        <figcaption className="truncate text-muted-foreground text-xs" title={item.label}>
          {item.label}
        </figcaption>
      )}
    </figure>
  );
}

function EvidenceLine({ item }: { item: Evidence }) {
  if (item.kind === "link" && isWebUrl(item.ref)) {
    return (
      <>
        <a href={item.ref} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <ExternalLink aria-hidden />
          {item.label ?? item.ref}
        </a>
        {item.label === undefined ? null : (
          <span className="break-all font-mono text-muted-foreground">{item.ref}</span>
        )}
      </>
    );
  }
  if (item.kind === "file") {
    const name = evidenceName(item.ref);
    return (
      <>
        <a href={evidenceUrl(item.ref)} download={name} className={linkClass}>
          <Download aria-hidden />
          {item.label ?? name}
        </a>
        {item.label === undefined ? null : (
          <span className="font-mono text-muted-foreground">{name}</span>
        )}
      </>
    );
  }
  // Ingest's references (and anything else) name nothing the viewer serves.
  return (
    <>
      <span className="text-muted-foreground">{item.kind}</span>
      <span className="break-all font-mono">{item.ref}</span>
    </>
  );
}

/** A file `run` stored: `<project>/context/tests/.runs/<run>/<case>/<name>` (core decides; this only picks the element). */
const STORED = /^(?:[^/]+\/)*context\/tests\/\.runs\/[^/]+\/[^/]+\/[^/]+$/;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * One ref of a milestone's evidence, which keeps refs only: a link opens, a
 * stored file opens (an image as a small thumbnail too), anything else is text.
 */
export function EvidenceRef({ value }: { value: string }) {
  if (isWebUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <ExternalLink aria-hidden className="print:hidden" />
        <span className="break-all">{value}</span>
      </a>
    );
  }
  if (STORED.test(value) && !value.split("/").includes("..")) {
    const url = evidenceUrl(value);
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col items-start gap-1 rounded-sm font-mono text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {IMAGE.test(value) ? (
          <img
            src={url}
            alt={evidenceName(value)}
            loading="lazy"
            className="h-16 w-auto max-w-40 rounded-sm border bg-muted object-cover"
          />
        ) : null}
        <span className="break-all">{value}</span>
      </a>
    );
  }
  return <span className="font-mono text-muted-foreground">{value}</span>;
}
