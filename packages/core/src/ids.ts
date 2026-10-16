const CASE_ID = /^TC-([0-9]{4,})$/;

/** Next `TC-` id: one above the highest existing number, at least four digits. */
export function nextCaseId(existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const match = CASE_ID.exec(id);
    if (match?.[1] !== undefined) max = Math.max(max, Number(match[1]));
  }
  return `TC-${String(max + 1).padStart(4, "0")}`;
}
