import { useState } from "react";

/**
 * A per-viewer preference kept in `localStorage`: a convenience, never state
 * the page needs. Storage can be missing or throw (private windows, blocked
 * site data), so every read and write is guarded and the fallback is used.
 */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => readFlag(key, fallback));
  const set = (next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Not remembered this time; the page works the same.
    }
  };
  return [value, set];
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}
