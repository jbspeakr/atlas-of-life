import placesData from "../generated/places.json";
import visitsData from "../generated/visits.json";
import tripsData from "../generated/trips.json";
import homeData from "../generated/home.json";
import { placeKey } from "./place-key";
/**
 * The published atlas as the page reads it: places, visits, journeys and
 * homes with their indexes. Kept apart from the map so the page can render
 * its title and directory before MapLibre has downloaded.
 */
export type Place = {
  id: string;
  label: string;
  country: string;
  region?: string;
  city?: string;
  coordinates: [number, number];
  date?: string;
  dateRange?: [string, string];
  visitCount: number;
  /** How many of the visits were day trips from elsewhere. */
  dayTrips?: number;
};
export type PublicVisit = Omit<Place, "visitCount" | "dayTrips"> & {
  visitCount?: number;
  /** The place or home this day trip was made from. */
  from?: string;
};
export type Trip = {
  id: string;
  label: string;
  start: string;
  end: string;
  stops: string[];
  /** Home IDs the journey left from and returned to. */
  from?: string;
  to?: string;
};
/** The base journeys start from; never a visit, published at city precision. */
export type Home = {
  id: string;
  label: string;
  country: string;
  city: string;
  coordinates: [number, number];
  since?: string;
  until?: string;
};
export const places = placesData as Place[];
export const homes = homeData as Home[];
export const visits = visitsData as PublicVisit[];
export const trips = tripsData as Trip[];
export const visitsByPlace = new Map<string, PublicVisit[]>();
export const placeByVisit = new Map<string, Place>();
/** Day-trip visits by the place or home they were made from, in date order. */
export const dayTripsByBase = new Map<string, PublicVisit[]>();
const placeByKey = new Map(places.map((place) => [placeKey(place), place]));
for (const visit of visits) {
  if (!visit.visitCount) continue;
  const place = placeByKey.get(placeKey(visit));
  if (place) {
    let group = visitsByPlace.get(place.id);
    if (!group) {
      group = [];
      visitsByPlace.set(place.id, group);
    }
    group.push(visit);
    placeByVisit.set(visit.id, place);
  }
}
for (const visit of [...visits].sort((a, b) =>
  (a.date ?? a.dateRange?.[0] ?? "").localeCompare(b.date ?? b.dateRange?.[0] ?? ""),
)) {
  if (!visit.from || !placeByVisit.has(visit.id)) continue;
  dayTripsByBase.set(visit.from, [...(dayTripsByBase.get(visit.from) ?? []), visit]);
}
/** The expected error for a tile outside the archive's detail windows. */
export const isMissingTile = (error: { message: string }) =>
  error.message === "Tile not found.";
