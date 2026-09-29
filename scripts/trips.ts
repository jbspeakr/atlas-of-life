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
  /** The home the journey left from and returned to, when one was set. */
  from?: string;
  to?: string;
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
  return groupTrips(input).map((entry) => entry.trip);
}
/** Journeys with the visits that formed them, in journey order. */
export function groupTrips(
  input: readonly TripVisit[],
): { trip: Trip; visits: TripVisit[] }[] {
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
  const trips = groups.map((group): { trip: Trip; visits: TripVisit[] } => {
    const label = group[0].trip ?? tripLabel(group);
    const digest = createHash("sha256")
      .update(JSON.stringify(group.map((visit) => visit.id).sort()))
      .digest("hex")
      .slice(0, 8);
    const stops: string[] = [];
    for (const visit of group)
      if (stops[stops.length - 1] !== visit.placeId) stops.push(visit.placeId);
    return {
      trip: {
        id: `trip-${slug(label) || "journey"}-${digest}`,
        label,
        start: group.map((visit) => dateBounds(visit)[0]).sort()[0],
        end: group.map((visit) => dateBounds(visit)[1]).sort().at(-1)!,
        stops,
      },
      visits: group,
    };
  });
  return trips
    .filter(({ trip }) => trip.stops.length > 1)
    .sort(
      (a, b) =>
        a.trip.start.localeCompare(b.trip.start) || a.trip.id.localeCompare(b.trip.id),
    );
}

const rad = Math.PI / 180;
/** Great-circle vertices every `stepKm`, with longitudes unwrapped for continuity. */
export function densify(
  points: readonly [number, number][],
  stepKm = 100,
  minSteps = 1,
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
    const steps = Math.max(minSteps, Math.ceil((delta * 6371) / stepKm));
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

export type TripHome = {
  id: string;
  coordinates: [number, number];
  since?: string;
  until?: string;
};
/** The home in effect on a date, if any. */
export function homeAt(
  homes: readonly TripHome[],
  date: string,
): TripHome | undefined {
  return homes.find(
    (home) => (!home.since || home.since <= date) && (!home.until || date <= home.until),
  );
}
const earthKm = 6371;
function distanceKm(a: [number, number], b: [number, number]): number {
  const φ1 = a[1] * rad, φ2 = b[1] * rad;
  const cosDelta =
    Math.sin(φ1) * Math.sin(φ2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.cos((b[0] - a[0]) * rad);
  return Math.acos(Math.min(1, Math.max(-1, cosDelta))) * earthKm;
}
function bearing(a: [number, number], b: [number, number]): number {
  const φ1 = a[1] * rad, φ2 = b[1] * rad, Δλ = (b[0] - a[0]) * rad;
  return Math.atan2(
    Math.sin(Δλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ),
  );
}
function destination(
  [lng, lat]: [number, number],
  heading: number,
  km: number,
): [number, number] {
  const δ = km / earthKm, φ1 = lat * rad, λ1 = lng * rad;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(heading),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return [λ2 / rad, φ2 / rad];
}
/**
 * A symmetric arc between two places: the great circle, bowed sideways by a
 * parabola peaking at `bend` of the distance. `side` 1 bows to the right of
 * travel, -1 to the left. Curves read as "went from here to there", never as
 * the road taken, and longer hops curve more than short ones.
 */
export function arc(
  from: [number, number],
  to: [number, number],
  side: 1 | -1,
  bend = 0.14,
): [number, number][] {
  const base = densify([from, to], 40, 24);
  const km = distanceKm(from, to);
  const out: [number, number][] = base.map((point, i) => {
    if (i === 0 || i === base.length - 1) return [point[0], point[1]];
    const t = i / (base.length - 1);
    const heading = bearing(point, base[i + 1]);
    const [lng, lat] = destination(
      point,
      heading + (side * Math.PI) / 2,
      4 * bend * km * t * (1 - t),
    );
    return [Number(lng.toFixed(5)), Number(lat.toFixed(5))];
  });
  // Keep the whole line continuous across the antimeridian, endpoints included.
  for (let i = 1; i < out.length; i++)
    out[i][0] += Math.round((out[i - 1][0] - out[i][0]) / 360) * 360;
  return out;
}
/** Bow a loop outward: 1 (right of travel) for counter-clockwise loops. */
export function outwardSide(path: readonly [number, number][]): 1 | -1 {
  let area = 0;
  for (let i = 0; i < path.length; i++) {
    const [x1, y1] = path[i];
    const [x2, y2] = path[(i + 1) % path.length];
    area += x1 * y2 - x2 * y1;
  }
  return area < 0 ? -1 : 1;
}
export type RouteProperties = {
  id: string;
  /** A journey ID, or `place:<id>` for a trip to a single place. */
  group: string;
  kind: "hop" | "leg";
  order: number;
};
const samePoint = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
/**
 * Journeys gain home legs out and back; dated single-place trips outside a
 * journey gain the same legs under a `place:` group. All lines are arcs, drawn
 * only when their group is in focus.
 */
export function routeFeatures(
  grouped: readonly { trip: Trip; visits: readonly TripVisit[] }[],
  standalone: readonly TripVisit[],
  coordinatesByPlace: ReadonlyMap<string, [number, number]>,
  homes: readonly TripHome[] = [],
): {
  trips: Trip[];
  routes: FeatureCollection<LineString, RouteProperties>;
} {
  const features: Feature<LineString, RouteProperties>[] = [];
  const at = (stop: string) => {
    const point = coordinatesByPlace.get(stop);
    if (!point) throw new Error(`Route stop ${stop} has no published place`);
    return point;
  };
  const emit = (
    group: string,
    kind: RouteProperties["kind"],
    from: [number, number],
    to: [number, number],
    side: 1 | -1,
  ) => {
    const order = features.filter((feature) => feature.properties.group === group).length;
    const id = `${group}:${order}`;
    features.push({
      type: "Feature",
      id,
      properties: { id, group, kind, order },
      geometry: { type: "LineString", coordinates: arc(from, to, side) },
    });
  };
  const trips = grouped.map(({ trip }) => {
    const points = trip.stops.map(at);
    const out = homeAt(homes, trip.start);
    const back = homeAt(homes, trip.end);
    const leaves = out && !samePoint(out.coordinates, points[0]) ? out : undefined;
    const returns =
      back && !samePoint(back.coordinates, points[points.length - 1]) ? back : undefined;
    const side = outwardSide([
      ...(leaves ? [leaves.coordinates] : []),
      ...points,
      ...(returns ? [returns.coordinates] : []),
    ]);
    if (leaves) emit(trip.id, "leg", leaves.coordinates, points[0], side);
    for (let i = 1; i < points.length; i++)
      emit(trip.id, "hop", points[i - 1], points[i], side);
    if (returns) emit(trip.id, "leg", points[points.length - 1], returns.coordinates, side);
    return {
      ...trip,
      ...(leaves ? { from: leaves.id } : {}),
      ...(returns ? { to: returns.id } : {}),
    };
  });
  // A place visited on its own shows the way out and back as a lens.
  const seen = new Set<string>();
  for (const visit of standalone) {
    if (!isDated(visit)) continue;
    const [start, end] = dateBounds(visit);
    if (start === openStart || end === openEnd) continue;
    const point = at(visit.placeId);
    const out = homeAt(homes, start);
    const back = homeAt(homes, end);
    const group = `place:${visit.placeId}`;
    const key = `${group}|${out?.id ?? ""}|${back?.id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (out && !samePoint(out.coordinates, point)) emit(group, "leg", out.coordinates, point, 1);
    if (back && !samePoint(back.coordinates, point)) emit(group, "leg", point, back.coordinates, 1);
  }
  return { trips, routes: { type: "FeatureCollection", features } };
}
