import { NOTE_MAX } from "../schema/index.js";

/**
 * A note cut to `NOTE_MAX` characters, the last one `…` (ADR run-event-note §2).
 * Internal, not in the public API: `ingest` and `run` build events from text of
 * any length, and the schema only checks the bound.
 */
export function boundNote(note: string | undefined): string | undefined {
  if (note === undefined || note.length <= NOTE_MAX) return note;
  // `max` counts UTF-16 units, like `length`; a pair is not split.
  const cut = note.slice(0, NOTE_MAX - 1).replace(/[\uD800-\uDBFF]$/, "");
  return `${cut}…`;
}
