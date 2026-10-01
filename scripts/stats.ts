import continentsData from "../data/continents.json";
import { placeKey } from "../src/map/place-key.ts";
import { dateBounds, isDated, nights, openEnd, openStart } from "../src/map/time.ts";
import type { Place, PublicHome, PublicVisit } from "./config.ts";
import { distanceKm, homeAt, type Trip } from "./trips.ts";

const continentOf = continentsData.continents as Record<string, string>;
const states = new Set<string>(continentsData.states);
/** The seven continents, with the number of states each holds. */
const continentStates = new Map<string, number>();
for (const code of states)
  continentStates.set(continentOf[code], (continentStates.get(continentOf[code]) ?? 0) + 1);
continentStates.set("Antarctica", continentStates.get("Antarctica") ?? 0);
export const worldStates = states.size;
export const worldContinents = continentStates.size;
const arcticCircle = 66.5633;
const day = 86_400_000;

/**
 * One sentence each in the numbers panel. Places, homes and journeys are
 * referenced by their public IDs so the panel can light them; the browser
 * resolves labels and coordinates from the files it already holds.
 */
export type Milestone =
  | { kind: "first"; place: string; date: string }
  | { kind: "distance"; km: number }
  | { kind: "furthest"; place: string; home: string; km: number }
  | { kind: "journey"; trip: string; nights: number; stops: number; countries: number }
  | { kind: "north" | "south" | "east" | "west"; place: string }
  | { kind: "arctic" | "antarctic" | "equator"; place: string; date?: string }
  | { kind: "nights"; country: string; nights: number }
  | { kind: "returns"; place: string; visits: number }
  | { kind: "gap"; from: string; to: string; days: number };
export type YearRow = {
  year: number;
  visits: number;
  nights: number;
  countries: number;
  /** Countries and places seen for the first time that year. */
  newCountries: number;
  newPlaces: number;
  furthest: { place: string; km: number } | null;
  longestStay: { place: string; nights: number } | null;
};
export type Stats = {
  countries: number;
  regions: number;
  places: number;
  visits: number;
  journeys: number;
  nights: number;
  firstYear: number | null;
  lastYear: number | null;
  longestStay: { place: string; label: string; nights: number } | null;
  coverage: {
    /** Visited UN member and observer states, of 195. */
    states: number;
    of: number;
    /** Visited territories and other codes outside that list. */
    territories: number;
    continents: { continent: string; visited: number; of: number }[];
    continentsOf: number;
  };
  milestones: Milestone[];
  years: YearRow[];
  byCountry: {
    country: string;
    places: number;
    regions: number;
    /** Subdivisions in the boundary source; null when the country was never resolved to one. */
    regionsOf: number | null;
    firstYear: number | null;
  }[];
};
export type StatsInput = {
  trips?: readonly Trip[];
  homes?: readonly PublicHome[];
  /** The endpoints of every published route, hop or leg, for the crow-flies total. */
  legs?: readonly (readonly [[number, number], [number, number]])[];
  /** Subdivisions per country in the boundary source. */
  regionsOf?: Readonly<Record<string, number>>;
};
const realStart = (visit: PublicVisit) => {
  const start = dateBounds(visit)[0];
  return start === openStart ? null : start;
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day);
const byStart = (a: PublicVisit, b: PublicVisit) =>
  dateBounds(a)[0].localeCompare(dateBounds(b)[0]) || a.id.localeCompare(b.id);

/** Totals derived only from published visits, places and journeys. Nights count toward the start year. */
export function computeStats(
  visits: readonly PublicVisit[],
  places: readonly Place[],
  input: StatsInput = {},
): Stats {
  const { trips = [], homes = [], legs = [], regionsOf = {} } = input;
  const placeByKey = new Map(places.map((place) => [placeKey(place), place]));
  const placeOf = (visit: PublicVisit) => placeByKey.get(placeKey(visit));
  const cityVisits = visits
    .filter((visit) => visit.visitCount && placeOf(visit))
    .sort(byStart);
  const dated = cityVisits.filter((visit) => realStart(visit) !== null);
  const homeFor = (visit: PublicVisit) =>
    homes.length ? (homeAt(homes, dateBounds(visit)[0]) ?? homes[0]) : undefined;
  const fromHome = (visit: PublicVisit) => {
    const home = homeFor(visit);
    return home ? { home, km: Math.round(distanceKm(home.coordinates, visit.coordinates)) } : null;
  };

  const years = new Map<number, YearRow>();
  const seenCountries = new Set<string>();
  const seenPlaces = new Set<string>();
  const yearCountries = new Map<number, Set<string>>();
  let longest: Stats["longestStay"] = null;
  let total = 0;
  for (const visit of cityVisits) {
    const place = placeOf(visit)!;
    const stay = nights(visit) ?? 0;
    total += stay;
    if (stay && (!longest || stay > longest.nights))
      longest = { place: place.id, label: visit.label, nights: stay };
    const start = realStart(visit);
    if (start === null) continue;
    const year = Number(start.slice(0, 4));
    const row = years.get(year) ?? {
      year,
      visits: 0,
      nights: 0,
      countries: 0,
      newCountries: 0,
      newPlaces: 0,
      furthest: null,
      longestStay: null,
    };
    row.visits += 1;
    row.nights += stay;
    if (!seenCountries.has(visit.country)) row.newCountries += 1;
    if (!seenPlaces.has(place.id)) row.newPlaces += 1;
    seenCountries.add(visit.country);
    seenPlaces.add(place.id);
    const away = fromHome(visit);
    if (away && (!row.furthest || away.km > row.furthest.km))
      row.furthest = { place: place.id, km: away.km };
    if (stay && (!row.longestStay || stay > row.longestStay.nights))
      row.longestStay = { place: place.id, nights: stay };
    const countries = yearCountries.get(year) ?? new Set<string>();
    countries.add(visit.country);
    yearCountries.set(year, countries);
    row.countries = countries.size;
    years.set(year, row);
  }

  const byCountry = new Map<string, Stats["byCountry"][number]>();
  const countryRow = (country: string) => {
    const row = byCountry.get(country) ?? {
      country,
      places: 0,
      regions: 0,
      regionsOf: regionsOf[country] ?? null,
      firstYear: null,
    };
    byCountry.set(country, row);
    return row;
  };
  for (const place of places) {
    const row = countryRow(place.country);
    row.places += 1;
    const start = isDated(place) ? dateBounds(place)[0] : "";
    if (start && start !== openStart) {
      const year = Number(start.slice(0, 4));
      row.firstYear = row.firstYear === null ? year : Math.min(row.firstYear, year);
    }
  }
  const regionsByCountry = new Map<string, Set<string>>();
  for (const visit of visits) {
    countryRow(visit.country);
    if (!visit.region) continue;
    const regions = regionsByCountry.get(visit.country) ?? new Set<string>();
    regions.add(visit.region);
    regionsByCountry.set(visit.country, regions);
  }
  for (const [country, regions] of regionsByCountry) countryRow(country).regions = regions.size;

  const visitedCodes = [...byCountry.keys()];
  const visitedByContinent = new Map<string, number>();
  for (const code of visitedCodes) {
    const continent = continentOf[code];
    if (continent) visitedByContinent.set(continent, (visitedByContinent.get(continent) ?? 0) + 1);
  }
  const coverage: Stats["coverage"] = {
    states: visitedCodes.filter((code) => states.has(code)).length,
    of: worldStates,
    territories: visitedCodes.filter((code) => !states.has(code)).length,
    continents: [...visitedByContinent]
      .map(([continent, visited]) => ({
        continent,
        visited,
        of: continentStates.get(continent) ?? 0,
      }))
      .sort((a, b) => b.visited - a.visited || a.continent.localeCompare(b.continent)),
    continentsOf: worldContinents,
  };

  const milestones: Milestone[] = [];
  if (dated.length)
    milestones.push({ kind: "first", place: placeOf(dated[0])!.id, date: realStart(dated[0])! });
  const km = Math.round(legs.reduce((sum, [from, to]) => sum + distanceKm(from, to), 0));
  if (km > 0) milestones.push({ kind: "distance", km });
  let furthest: Extract<Milestone, { kind: "furthest" }> | null = null;
  for (const visit of cityVisits) {
    const away = fromHome(visit);
    if (away && (!furthest || away.km > furthest.km))
      furthest = { kind: "furthest", place: placeOf(visit)!.id, home: away.home.id, km: away.km };
  }
  if (furthest && furthest.km > 0) milestones.push(furthest);
  const placeById = new Map(places.map((place) => [place.id, place]));
  const journey = trips
    .map((trip) => ({
      kind: "journey" as const,
      trip: trip.id,
      nights: daysBetween(trip.start, trip.end),
      stops: trip.stops.length,
      countries: new Set(trip.stops.map((stop) => placeById.get(stop)?.country)).size,
    }))
    .sort((a, b) => b.nights - a.nights || b.stops - a.stops || a.trip.localeCompare(b.trip))[0];
  if (journey) milestones.push(journey);
  if (places.length > 1) {
    const extreme = (kind: "north" | "south" | "east" | "west") => {
      const axis = kind === "north" || kind === "south" ? 1 : 0;
      const sign = kind === "north" || kind === "east" ? 1 : -1;
      const place = [...places].sort(
        (a, b) => sign * (b.coordinates[axis] - a.coordinates[axis]) || a.id.localeCompare(b.id),
      )[0];
      return { kind, place: place.id };
    };
    milestones.push(extreme("north"), extreme("south"), extreme("east"), extreme("west"));
  }
  const crossings: ["arctic" | "antarctic" | "equator", (lat: number) => boolean][] = [
    ["arctic", (lat) => lat > arcticCircle],
    ["antarctic", (lat) => lat < -arcticCircle],
    ["equator", (lat) => lat < 0],
  ];
  for (const [kind, beyond] of crossings) {
    // The first dated crossing; an undated one still counts, without a date.
    const first =
      dated.find((visit) => beyond(visit.coordinates[1])) ??
      cityVisits.find((visit) => beyond(visit.coordinates[1]));
    if (!first) continue;
    const date = realStart(first);
    milestones.push({ kind, place: placeOf(first)!.id, ...(date ? { date } : {}) });
  }
  if (byCountry.size > 1) {
    const nightsByCountry = new Map<string, number>();
    for (const visit of cityVisits)
      nightsByCountry.set(
        visit.country,
        (nightsByCountry.get(visit.country) ?? 0) + (nights(visit) ?? 0),
      );
    const most = [...nightsByCountry]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (most && most[1] > 0) milestones.push({ kind: "nights", country: most[0], nights: most[1] });
  }
  const returned = [...places].sort((a, b) => b.visitCount - a.visitCount || byStart(a, b))[0];
  if (returned && returned.visitCount > 1)
    milestones.push({ kind: "returns", place: returned.id, visits: returned.visitCount });
  const closed = dated.filter((visit) => dateBounds(visit)[1] !== openEnd);
  let gap: Extract<Milestone, { kind: "gap" }> | null = null;
  for (let i = 1; i < closed.length; i++) {
    const days = daysBetween(dateBounds(closed[i - 1])[1], dateBounds(closed[i])[0]);
    if (days > (gap?.days ?? 0))
      gap = { kind: "gap", from: placeOf(closed[i - 1])!.id, to: placeOf(closed[i])!.id, days };
  }
  if (gap) milestones.push(gap);

  const sortedYears = [...years.keys()].sort((a, b) => a - b);
  return {
    countries: byCountry.size,
    regions: new Set(visits.map((visit) => visit.region).filter(Boolean)).size,
    places: places.length,
    visits: cityVisits.length,
    journeys: trips.length,
    nights: total,
    firstYear: sortedYears[0] ?? null,
    lastYear: sortedYears[sortedYears.length - 1] ?? null,
    longestStay: longest,
    coverage,
    milestones,
    years: sortedYears.map((year) => years.get(year)!),
    byCountry: [...byCountry.values()].sort(
      (a, b) => b.places - a.places || a.country.localeCompare(b.country),
    ),
  };
}
