/** Date predicates shared by the build, the map filter and the directory. */
export type Dated = { date?: string; dateRange?: [string, string] };
export type TimeMode = "cumulative" | "only";
export const openStart = "0001-01-01";
export const openEnd = "9999-12-31";
export function dateBounds(value: Dated): [string, string] {
  if (value.date) return [value.date, value.date];
  return [value.dateRange?.[0] || openStart, value.dateRange?.[1] || openEnd];
}
export function isDated(value: Dated): boolean {
  return value.date !== undefined || value.dateRange !== undefined;
}
/**
 * 1 when the visit is lit for the selected position, else 0.
 * `through` is an ISO date or null for every visit. Cumulative means
 * "first visited by this date"; only means "under way during that month".
 * Undated visits are always lit.
 */
export function visibleAt(
  visit: Dated,
  through: string | null,
  mode: TimeMode = "cumulative",
): number {
  if (through === null || !isDated(visit)) return 1;
  const [start, end] = dateBounds(visit);
  if (mode === "cumulative") return start <= through ? 1 : 0;
  const month = through.slice(0, 7);
  // Lexical bounds: "-31" exceeds any real day and "-01" precedes it, so no calendar maths.
  return start <= `${month}-31` && end >= `${month}-01` ? 1 : 0;
}
/** Whole nights between the range endpoints; undefined for single days and open ranges. */
export function nights(visit: Dated): number | undefined {
  if (!visit.dateRange || !visit.dateRange[0] || !visit.dateRange[1]) return undefined;
  const [start, end] = visit.dateRange;
  const days = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
  return days > 0 ? days : undefined;
}
