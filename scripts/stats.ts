import { dateBounds, isDated, nights } from "../src/map/time.ts";
import type { Place, PublicVisit } from "./config.ts";

export type Stats = {
  countries: number;
  regions: number;
  places: number;
  visits: number;
  journeys: number;
  nights: number;
  firstYear: number | null;
  lastYear: number | null;
  longestStay: { label: string; nights: number } | null;
  years: { year: number; visits: number; nights: number; countries: number }[];
  byCountry: { country: string; places: number; firstYear: number | null }[];
};
/** Totals derived only from published visits, places and journeys. Nights count toward the start year. */
export function computeStats(
  visits: readonly PublicVisit[],
  places: readonly Place[],
  journeys: number,
): Stats {
  const cityVisits = visits.filter((visit) => visit.visitCount);
  const years = new Map<number, { visits: number; nights: number; countries: Set<string> }>();
  let longest: Stats["longestStay"] = null;
  let total = 0;
  for (const visit of cityVisits) {
    const stay = nights(visit) ?? 0;
    total += stay;
    if (stay && (!longest || stay > longest.nights)) longest = { label: visit.label, nights: stay };
    if (!isDated(visit)) continue;
    const start = dateBounds(visit)[0];
    if (start.startsWith("0001")) continue;
    const year = Number(start.slice(0, 4));
    const row = years.get(year) ?? { visits: 0, nights: 0, countries: new Set<string>() };
    row.visits += 1;
    row.nights += stay;
    row.countries.add(visit.country);
    years.set(year, row);
  }
  const byCountry = new Map<string, { places: number; firstYear: number | null }>();
  for (const place of places) {
    const row = byCountry.get(place.country) ?? { places: 0, firstYear: null };
    row.places += 1;
    const start = isDated(place) ? dateBounds(place)[0] : "";
    if (start && !start.startsWith("0001")) {
      const year = Number(start.slice(0, 4));
      row.firstYear = row.firstYear === null ? year : Math.min(row.firstYear, year);
    }
    byCountry.set(place.country, row);
  }
  for (const visit of visits)
    if (!byCountry.has(visit.country)) byCountry.set(visit.country, { places: 0, firstYear: null });
  const sortedYears = [...years.keys()].sort((a, b) => a - b);
  return {
    countries: byCountry.size,
    regions: new Set(visits.map((visit) => visit.region).filter(Boolean)).size,
    places: places.length,
    visits: cityVisits.length,
    journeys,
    nights: total,
    firstYear: sortedYears[0] ?? null,
    lastYear: sortedYears[sortedYears.length - 1] ?? null,
    longestStay: longest,
    years: sortedYears.map((year) => {
      const row = years.get(year)!;
      return { year, visits: row.visits, nights: row.nights, countries: row.countries.size };
    }),
    byCountry: [...byCountry.entries()]
      .map(([country, row]) => ({ country, ...row }))
      .sort((a, b) => b.places - a.places || a.country.localeCompare(b.country)),
  };
}
