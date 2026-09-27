import { createHash } from "node:crypto";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { slug } from "../src/map/text.ts";
import { dateBounds, isDated, openEnd, openStart } from "../src/map/time.ts";

/** A dated, located visit with the place it collapsed into. */
export type TripVisit = {
  id: string;
  placeId: string;
  country: string;
  coordinates: [number, number];
  trip?: string;
  date?: string;
  dateRange?: [string, string];
};
export type Trip = {
  id: string;
  label: string;
  start: string;
  end: string;
  stops: string[];
};
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const day = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * day).toISOString().slice(0, 10);

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
/** "Denmark, Norway and Sweden, 2025" from the stops' countries in visiting order. */
export function tripLabel(visits: readonly TripVisit[]): string {
  const countries = [...new Set(visits.map((visit) => visit.country))].map(
    (code) => countryNames.of(code) ?? code,
  );
  const years = [...new Set(visits.map((visit) => dateBounds(visit)[0].slice(0, 4)))].sort();
  const span = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0];
  return `${list(countries)}, ${span}`;
}
/**
 * Chains dated city visits into journeys. A visit joins the current journey
 * when it starts no later than the day after the journey's latest end;
 * visits sharing an authored `trip` label always form one journey. Journeys
 * need two or more visits; open-ended ranges and undated visits never join.
 */
export function inferTrips(input: readonly TripVisit[]): Trip[] {
  const eligible = input
    .filter((visit) => isDated(visit))
    .filter((visit) => {
      const [start, end] = dateBounds(visit);
      return start !== openStart && end !== openEnd;
    })
    .sort(
      (a, b) =>
        dateBounds(a)[0].localeCompare(dateBounds(b)[0]) ||
        dateBounds(a)[1].localeCompare(dateBounds(b)[1]) ||
        a.id.localeCompare(b.id),
    );
  const groups: TripVisit[][] = [];
  const authored = new Map<string, TripVisit[]>();
  let current: TripVisit[] = [];
  let latestEnd = "";
  for (const visit of eligible) {
    if (visit.trip) {
      const group = authored.get(visit.trip) ?? [];
      group.push(visit);
      authored.set(visit.trip, group);
      continue;
    }
    const [start, end] = dateBounds(visit);
    if (current.length && start <= addDays(latestEnd, 1)) {
      current.push(visit);
      if (end > latestEnd) latestEnd = end;
    } else {
      if (current.length > 1) groups.push(current);
      current = [visit];
      latestEnd = end;
    }
  }
  if (current.length > 1) groups.push(current);
  for (const group of authored.values()) if (group.length > 1) groups.push(group);
  const trips = groups.map((group) => {
    const label = group[0].trip ?? tripLabel(group);
    const digest = createHash("sha256")
      .update(JSON.stringify(group.map((visit) => visit.id).sort()))
      .digest("hex")
      .slice(0, 8);
    const stops: string[] = [];
    for (const visit of group)
      if (stops[stops.length - 1] !== visit.placeId) stops.push(visit.placeId);
    return {
      id: `trip-${slug(label) || "journey"}-${digest}`,
      label,
      start: group.map((visit) => dateBounds(visit)[0]).sort()[0],
      end: group.map((visit) => dateBounds(visit)[1]).sort().at(-1)!,
      stops,
    };
  });
  return trips
    .filter((trip) => trip.stops.length > 1)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

const rad = Math.PI / 180;
/** Great-circle vertices every `stepKm`, with longitudes unwrapped for continuity. */
export function densify(
  points: readonly [number, number][],
  stepKm = 100,
): [number, number][] {
  if (points.length < 2) return points.map(([x, y]) => [x, y]);
  const out: [number, number][] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; i++) {
    const [lng1, lat1] = points[i - 1];
    const [lng2, lat2] = points[i];
    const φ1 = lat1 * rad, φ2 = lat2 * rad;
    const λ1 = lng1 * rad, λ2 = lng2 * rad;
    const cosDelta =
      Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    const delta = Math.acos(Math.min(1, Math.max(-1, cosDelta)));
    const steps = Math.max(1, Math.ceil((delta * 6371) / stepKm));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      let lng: number, lat: number;
      if (delta < 1e-9) {
        lng = lng2;
        lat = lat2;
      } else {
        const a = Math.sin((1 - f) * delta) / Math.sin(delta);
        const b = Math.sin(f * delta) / Math.sin(delta);
        const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
        const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
        const z = a * Math.sin(φ1) + b * Math.sin(φ2);
        lat = Math.atan2(z, Math.hypot(x, y)) / rad;
        lng = Math.atan2(y, x) / rad;
      }
      const previous = out[out.length - 1][0];
      lng += Math.round((previous - lng) / 360) * 360;
      out.push([Number(lng.toFixed(5)), Number(lat.toFixed(5))]);
    }
  }
  // The final vertex is the published place coordinate, shifted by whole turns
  // only when the preceding vertex was unwrapped across the antimeridian.
  const last = points[points.length - 1];
  const previous = out[out.length - 2]?.[0] ?? last[0];
  out[out.length - 1] = [last[0] + Math.round((previous - last[0]) / 360) * 360, last[1]];
  return out;
}

export function routeFeatures(
  trips: readonly Trip[],
  coordinatesByPlace: ReadonlyMap<string, [number, number]>,
): FeatureCollection<LineString, { trip: string }> {
  const features: Feature<LineString, { trip: string }>[] = trips.map((trip) => ({
    type: "Feature",
    id: trip.id,
    properties: { trip: trip.id },
    geometry: {
      type: "LineString",
      coordinates: densify(
        trip.stops.map((stop) => {
          const point = coordinatesByPlace.get(stop);
          if (!point) throw new Error(`Route stop ${stop} has no published place`);
          return point;
        }),
      ),
    },
  }));
  return { type: "FeatureCollection", features };
}
