// Minimal glob matcher for `writes` patterns (ADR extension-model). Paths and
// patterns are workspace-relative and POSIX. `path.matchesGlob` is still
// experimental in Node 22, and a dependency is not worth these few rules:
//   `**`  any number of whole segments, including none
//   `*`   any characters inside one segment
//   `?`   one character inside one segment

const cache = new Map<string, RegExp>();

export function matchesGlob(path: string, pattern: string): boolean {
  let regex = cache.get(pattern);
  if (regex === undefined) {
    regex = toRegExp(pattern);
    cache.set(pattern, regex);
  }
  return regex.test(path);
}

function toRegExp(pattern: string): RegExp {
  const segments = pattern.split("/");
  let source = "";
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === "**") {
      // `a/**/b` → `a/` + zero or more `x/` + `b`; a trailing `**` also matches nothing.
      source += last ? "(?:.*)?" : "(?:[^/]+/)*";
      return;
    }
    source += segment
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");
    if (!last) source += "/";
  });
  // `context/tests/**` becomes `^context/tests/(?:.*)?$`: it matches anything
  // below the directory, not the directory path itself.
  return new RegExp(`^${source}$`);
}
