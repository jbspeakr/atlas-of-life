import { homes, placeByVisit, trips, visits } from "../map/data";
import type { Catalog } from "./atlas-state";
const homeIds = new Set(homes.map((home) => home.id));
const tripIds = new Set(trips.map((trip) => trip.id));
/** The published atlas as the transitions see it. */
export const atlasCatalog: Catalog = {
  resolvePlace(id) {
    if (homeIds.has(id)) return id;
    const place = placeByVisit.get(id);
    if (place) return place.id;
    // Legacy links carried a 64-character digest; the current ID is its prefix.
    const visit = visits.find((candidate) => id.startsWith(candidate.id) && placeByVisit.has(candidate.id));
    return visit ? placeByVisit.get(visit.id)!.id : undefined;
  },
  hasJourney: (id) => tripIds.has(id),
};
