import {
  dayTripsByBase,
  homes,
  placeByVisit,
  places,
  trips,
  visits,
  visitsByPlace,
} from "../map/data";
import { fold } from "../map/text";
import { dateBounds, isDated, nights } from "../map/time";
import regionLabelsData from "../generated/region-labels.json";
import statsData from "../generated/stats.json";
import type { Stats } from "../../scripts/stats";
import { countryName } from "./format";
/** The published atlas arranged for the interface: indexes, itineraries and search text. */
export const stats = statsData as unknown as Stats;
export const regionLabels: Record<string, string> = regionLabelsData;
export const tripById = new Map(trips.map((trip) => [trip.id, trip]));
export const homeById = new Map(homes.map((home) => [home.id, home]));
export const placeById = new Map(places.map((place) => [place.id, place]));
const years = [
  ...visits.flatMap((v) => [v.date, ...(v.dateRange ?? [])]),
  ...homes.map((home) => home.since),
]
  .filter((s): s is string => Boolean(s))
  .map((s) => Number(s.slice(0, 4)));
export const firstYear = Math.min(...years, new Date().getUTCFullYear());
export const lastYear = Math.max(...years, firstYear);
// One scrubber position per distinct first-visit date, plus the day each home
// began, so the atlas opens at home; the last position means every visit.
export const positions = [
  ...new Set([
    ...visits.filter(isDated).map((visit) => dateBounds(visit)[0]),
    ...homes.flatMap((home) => (home.since ? [home.since] : [])),
  ]),
].sort();
export const chronology = [...places].sort(
  (a, b) =>
    (a.date ?? a.dateRange?.[0] ?? "9999").localeCompare(
      b.date ?? b.dateRange?.[0] ?? "9999",
    ) || a.id.localeCompare(b.id),
);
/** The places a base's day trips went to, each once, in date order. */
export const dayTripPlaces = (base: string, within?: { start: string; end: string }): string[] => [
  ...new Set(
    (dayTripsByBase.get(base) ?? [])
      .filter((visit) => {
        if (!within) return true;
        const [start] = dateBounds(visit);
        return within.start <= start && start <= within.end;
      })
      .map((visit) => placeByVisit.get(visit.id)!.id),
  ),
];
export type JourneyRecord = (typeof trips)[number];
/** The places passed on the way along one hop: 0 is the leg out, stops.length the leg home. */
export const viaPlaces = (trip: JourneyRecord, hop: number): string[] => trip.via?.[hop] ?? [];
/**
 * A journey in walking order: each numbered stop, then the day trips made from
 * it, then the places passed on the way to the next stop. Stepping through a
 * journey follows this sequence; the itinerary strip draws it as segments with
 * their satellites and the marks between them.
 */
export type ItineraryEntry = { id: string; stop?: number; from?: string; between?: [string, string] };
const viaEntries = (trip: JourneyRecord, hop: number): ItineraryEntry[] =>
  viaPlaces(trip, hop).map((id) => ({
    id,
    between: [
      hop === 0 ? (trip.from ?? "") : trip.stops[hop - 1],
      hop === trip.stops.length ? (trip.to ?? "") : trip.stops[hop],
    ],
  }));
export const itineraries = new Map<string, ItineraryEntry[]>(
  trips.map((trip) => [
    trip.id,
    [
      ...viaEntries(trip, 0),
      ...trip.stops.flatMap((stop, index) => [
        { id: stop, stop: index + 1 },
        ...dayTripPlaces(stop, trip).map((id) => ({ id, from: stop })),
        ...viaEntries(trip, index + 1),
      ]),
    ],
  ]),
);
export const tripByPlace = new Map<string, { trip: JourneyRecord; index: number }>();
for (const trip of trips)
  itineraries.get(trip.id)!.forEach((entry, index) => {
    if (!tripByPlace.has(entry.id)) tripByPlace.set(entry.id, { trip, index });
  });
export const tripDayTrips = (trip: JourneyRecord) =>
  itineraries.get(trip.id)!.filter((entry) => entry.from).length;
export const tripVia = (trip: JourneyRecord) =>
  itineraries.get(trip.id)!.filter((entry) => entry.between).length;
/** Whether the place was only ever seen on day trips or passed on the way: visited, never slept in. */
export const neverSlept = (place: { visitCount: number; dayTrips?: number; via?: number }) =>
  (place.dayTrips ?? 0) + (place.via ?? 0) >= place.visitCount;
export const baseLabel = (id: string) => placeById.get(id)?.label ?? homeById.get(id)?.label ?? id;
/** Nights spent at each stop within the journey's dates, for the itinerary strip. */
export const stopNights = new Map(
  trips.map((trip) => [
    trip.id,
    trip.stops.map((stop) =>
      (visitsByPlace.get(stop) ?? [])
        .filter((visit) => {
          const [start, end] = dateBounds(visit);
          return start <= trip.end && end >= trip.start;
        })
        .reduce((total, visit) => total + (nights(visit) ?? 0), 0),
    ),
  ]),
);
export function roundTrip(trip: JourneyRecord): string | undefined {
  const from = trip.from ? homeById.get(trip.from) : undefined;
  const to = trip.to ? homeById.get(trip.to) : undefined;
  if (from && to && from.id === to.id) return `Round trip from ${from.label}`;
  if (from && to) return `From ${from.label}, back to ${to.label}`;
  if (from) return `From ${from.label}`;
  if (to) return `Back to ${to.label}`;
  return undefined;
}
export const searchableTrips = trips.map((trip) => ({
  ...trip,
  dayTrips: tripDayTrips(trip),
  onTheWay: tripVia(trip),
  searchText: fold(trip.label),
}));
export const searchablePlaces = chronology.map((place) => ({
  ...place,
  countryName: countryName(place.country),
  searchText: fold(
    [
      place.label,
      countryName(place.country),
      place.region ? regionLabels[place.region] : "",
    ].join(" "),
  ),
  firstVisit: Math.min(...(visitsByPlace.get(place.id) ?? []).map((visit) => {
    const date = visit.date ?? visit.dateRange?.[0];
    return date ? Number(date.slice(0, 4)) : -Infinity;
  })),
}));
