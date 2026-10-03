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
  /** Authored: a day out even on a stay's arrival or departure day, or from home. */
  dayTrip?: boolean;
  /** The place or home the day trip was made from, once resolved. */
  from?: string;
  /** Authored: on the way although a night was spent in transit, so the dates alone cannot tell. */
  via?: boolean;
  /** Position in the authored list, which is written in travel order. */
  index?: number;
  /** The stop or home left and the one reached, once resolved as a stop on the way. */
  between?: [string, string];
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
  /**
   * Places passed on the way, in travel order: one list per hop, the leg out
   * first, then each hop between stops, the leg home last. Absent when none.
   */
  via?: string[][];
};
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const day = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
const byStart = (a: TripVisit, b: TripVisit) =>
  dateBounds(a)[0].localeCompare(dateBounds(b)[0]) ||
  dateBounds(a)[1].localeCompare(dateBounds(b)[1]) ||
  a.id.localeCompare(b.id);
const closed = (visit: TripVisit) => {
  const [start, end] = dateBounds(visit);
  return isDated(visit) && start !== openStart && end !== openEnd;
};
/** A closed range with at least one night: somewhere the traveller slept. */
const isStay = (visit: TripVisit) => closed(visit) && dateBounds(visit)[0] < dateBounds(visit)[1];
const covers = (stay: TripVisit, date: string) =>
  dateBounds(stay)[0] <= date && date <= dateBounds(stay)[1];
/**
 * Resolves day trips to the stay they were made from. A single-date visit
 * strictly inside a stay's range is a day trip from that stay (the innermost
 * when stays nest): the traveller slept at the base the night before and the
 * night after. An authored `dayTrip` also accepts a stay that merely shares
 * the day (the one woken up in) and, failing that, the home in effect; with
 * neither it is an error rather than a silent journey stop.
 */
export function assignDayTrips(
  input: readonly TripVisit[],
  homes: readonly TripHome[] = [],
): TripVisit[] {
  const stays = input.filter(isStay);
  return input.map((visit) => {
    const copy = { ...visit };
    delete copy.from;
    if (!closed(visit)) return copy;
    const [date, end] = dateBounds(visit);
    if (date !== end) return copy;
    const covering = stays
      .filter((stay) => stay.id !== visit.id && stay.placeId !== visit.placeId && covers(stay, date))
      .sort(byStart);
    const inside = covering
      .filter((stay) => dateBounds(stay)[0] < date && date < dateBounds(stay)[1])
      .at(-1);
    if (inside) return { ...copy, from: inside.placeId };
    if (!visit.dayTrip) return copy;
    if (covering.length) return { ...copy, from: covering[0].placeId };
    const home = homeAt(homes, date);
    if (home && home.id !== visit.placeId) return { ...copy, from: home.id };
    throw new Error(
      `${visit.id} is marked a day trip, but no stay or home covers ${date}`,
    );
  });
}

/**
 * Resolves stops on the way to the stop left and the stop reached. A single
 * dated visit that is not a day trip lies on the way when its date is the day
 * one stay ends and the next begins; with a home it is on the leg out when the
 * date begins the next stay and no stay adjoins the day before, and on the leg
 * home when it ends a stay and no stay adjoins the day after. An authored `via`
 * also accepts the stay that ended the day before or begins the day after (a
 * night in transit); it is an error when no stay adjoins at all. A visit a
 * stay adjoins on only one side without a home, or with a stay a day away on
 * the other side, keeps chaining as a stop: the dates say a night was slept
 * somewhere, and the atlas does not guess where.
 */
export function assignVia(
  input: readonly TripVisit[],
  homes: readonly TripHome[] = [],
): TripVisit[] {
  const stays = input.filter(isStay).sort(byStart);
  return input.map((visit) => {
    const copy = { ...visit };
    delete copy.between;
    if (!closed(visit) || visit.from) return copy;
    const [date, end] = dateBounds(visit);
    if (date !== end) return copy;
    const others = stays.filter(
      (stay) => stay.id !== visit.id && stay.placeId !== visit.placeId,
    );
    const endsOn = (day: string) => others.filter((stay) => dateBounds(stay)[1] === day).at(-1);
    const startsOn = (day: string) => others.find((stay) => dateBounds(stay)[0] === day);
    const left = endsOn(date) ?? (visit.via ? endsOn(addDays(date, -1)) : undefined);
    const right = startsOn(date) ?? (visit.via ? startsOn(addDays(date, 1)) : undefined);
    if (left && right)
      return left.placeId === right.placeId
        ? copy
        : { ...copy, between: [left.placeId, right.placeId] };
    const home = homeAt(homes, date);
    if (home && home.id !== visit.placeId) {
      if (left && !startsOn(addDays(date, 1))) return { ...copy, between: [left.placeId, home.id] };
      if (right && !endsOn(addDays(date, -1))) return { ...copy, between: [home.id, right.placeId] };
    }
    if (visit.via)
      throw new Error(`${visit.id} is marked on the way, but no stay ends or begins around ${date}`);
    return copy;
  });
}
const byAuthored = (a: TripVisit, b: TripVisit) =>
  (a.index ?? 0) - (b.index ?? 0) || byStart(a, b);

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
 * need two or more stops; open-ended ranges and undated visits never join,
 * and a day trip rides with the stay it was made from rather than chaining.
 */
export function inferTrips(input: readonly TripVisit[]): Trip[] {
  return groupTrips(input).map((entry) => entry.trip);
}
/** Journeys with the visits that formed them (stops first, then their day trips). */
export function groupTrips(
  input: readonly TripVisit[],
): { trip: Trip; visits: TripVisit[] }[] {
  const eligible = input.filter(closed).sort(byStart);
  const groups: TripVisit[][] = [];
  const authored = new Map<string, TripVisit[]>();
  let current: TripVisit[] = [];
  let latestEnd = "";
  for (const visit of eligible) {
    if (visit.from || visit.between) continue;
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
  // A day trip belongs to the journey whose stop it was made from.
  const dayTrips = groups.map((): TripVisit[] => []);
  for (const visit of eligible) {
    if (!visit.from) continue;
    const date = dateBounds(visit)[0];
    const index = groups.findIndex((group) =>
      group.some((stay) => stay.placeId === visit.from && covers(stay, date)),
    );
    if (index >= 0) dayTrips[index].push(visit);
  }
  // A stop on the way belongs to the journey whose hop or home leg it lies on:
  // between two consecutive stops, before the first or after the last.
  const stopsOf = (group: TripVisit[]) => {
    const stops: string[] = [];
    for (const visit of group)
      if (stops[stops.length - 1] !== visit.placeId) stops.push(visit.placeId);
    return stops;
  };
  const vias = groups.map((group): TripVisit[][] =>
    Array.from({ length: stopsOf(group).length + 1 }, () => []),
  );
  for (const visit of eligible) {
    if (!visit.between) continue;
    const [left, right] = visit.between;
    const date = dateBounds(visit)[0];
    for (const [index, group] of groups.entries()) {
      const stops = stopsOf(group);
      const start = group.map((stay) => dateBounds(stay)[0]).sort()[0];
      const end = group.map((stay) => dateBounds(stay)[1]).sort().at(-1)!;
      const hop = stops.findIndex((stop, i) => i > 0 && stops[i - 1] === left && stop === right);
      let slot = -1;
      if (hop > 0 && start <= date && date <= end) slot = hop;
      else if (right === stops[0] && !stops.includes(left) && addDays(start, -1) <= date && date <= start)
        slot = 0;
      else if (left === stops[stops.length - 1] && !stops.includes(right) && end <= date && date <= addDays(end, 1))
        slot = stops.length;
      if (slot < 0) continue;
      vias[index][slot].push(visit);
      break;
    }
  }
  const trips = groups.map((group, index): { trip: Trip; visits: TripVisit[] } => {
    const passed = vias[index].map((slot) => {
      const places: string[] = [];
      for (const visit of [...slot].sort(byAuthored))
        if (!places.includes(visit.placeId)) places.push(visit.placeId);
      return places;
    });
    const visits = [...group, ...dayTrips[index], ...vias[index].flat()];
    const label = group[0].trip ?? tripLabel([...visits].sort(byStart));
    // Stops alone identify a journey, so adding a day trip keeps its ID.
    const digest = createHash("sha256")
      .update(JSON.stringify(group.map((visit) => visit.id).sort()))
      .digest("hex")
      .slice(0, 8);
    const stops = stopsOf(group);
    return {
      trip: {
        id: `trip-${slug(label) || "journey"}-${digest}`,
        label,
        start: group.map((visit) => dateBounds(visit)[0]).sort()[0],
        end: group.map((visit) => dateBounds(visit)[1]).sort().at(-1)!,
        stops,
        ...(passed.some((slot) => slot.length) ? { via: passed } : {}),
      },
      visits,
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
/** Great-circle distance in kilometres. */
export function distanceKm(a: [number, number], b: [number, number]): number {
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
  /** A hop between stops, a leg from or to home, or one way of a day trip's lens. */
  kind: "hop" | "leg" | "excursion";
  order: number;
  /**
   * Excursions: the day trip's place, its base and the distance between them.
   * A hop or leg arriving at a stop on the way: that place and its distance
   * to the nearer of its two neighbours, which decides when its mark may show.
   */
  place?: string;
  from?: string;
  km?: number;
};
const samePoint = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
/**
 * Journeys gain home legs out and back; dated single-place trips outside a
 * journey gain the same legs under a `place:` group. A day trip adds a lens
 * (an arc out and an arc back) between its base and its place to the base's
 * group. All lines are arcs, drawn only when their group is in focus.
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
    extra: Pick<RouteProperties, "place" | "from" | "km"> = {},
  ) => {
    const order = features.filter((feature) => feature.properties.group === group).length;
    const id = `${group}:${order}`;
    features.push({
      type: "Feature",
      id,
      properties: { id, group, kind, order, ...extra },
      geometry: { type: "LineString", coordinates: arc(from, to, side) },
    });
  };
  const homeIds = new Set(homes.map((home) => home.id));
  // A hop or leg through the places passed on the way: one arc per step, the
  // arcs arriving at a waypoint naming it. Two arcs meeting at the town bend
  // the route there, which says "went this way, via here" and nothing more.
  const through = (
    group: string,
    kind: "hop" | "leg",
    from: [number, number],
    to: [number, number],
    side: 1 | -1,
    via: readonly string[],
  ) => {
    const chain = [from, ...via.map(at), to];
    for (let i = 1; i < chain.length; i++) {
      const place = via[i - 1];
      const extra = place
        ? {
            place,
            km:
              Math.round(
                Math.min(distanceKm(chain[i - 1], chain[i]), distanceKm(chain[i], chain[i + 1])) * 10,
              ) / 10,
          }
        : {};
      emit(group, kind, chain[i - 1], chain[i], side, extra);
    }
  };
  const seenExcursions = new Set<string>();
  // One lens per base and place, however often the day was repeated.
  const excursions = (group: string, visits: readonly TripVisit[], bases: ReadonlySet<string>) => {
    for (const visit of [...visits].sort(byStart)) {
      if (!visit.from || !bases.has(visit.from)) continue;
      const key = `${group}|${visit.from}|${visit.placeId}`;
      if (seenExcursions.has(key)) continue;
      seenExcursions.add(key);
      const base = at(visit.from);
      const point = at(visit.placeId);
      const extra = {
        place: visit.placeId,
        from: visit.from,
        km: Math.round(distanceKm(base, point) * 10) / 10,
      };
      emit(group, "excursion", base, point, 1, extra);
      emit(group, "excursion", point, base, 1, extra);
    }
  };
  const trips = grouped.map(({ trip, visits }) => {
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
    const via = (hop: number) => trip.via?.[hop] ?? [];
    if (leaves) through(trip.id, "leg", leaves.coordinates, points[0], side, via(0));
    for (let i = 1; i < points.length; i++)
      through(trip.id, "hop", points[i - 1], points[i], side, via(i));
    if (returns)
      through(trip.id, "leg", points[points.length - 1], returns.coordinates, side, via(points.length));
    excursions(trip.id, visits, new Set(trip.stops));
    return {
      ...trip,
      ...(leaves ? { from: leaves.id } : {}),
      ...(returns ? { to: returns.id } : {}),
    };
  });
  // A place visited on its own shows the way out and back as a lens; a day
  // trip from home is such a visit, and one from a stay draws under the stay.
  const seen = new Set<string>();
  // The places passed between a home and a lone stay, on the way there or back.
  const passed = (visit: TripVisit, between: [string, string], window: [string, string]) =>
    standalone
      .filter((candidate) => {
        const date = dateBounds(candidate)[0];
        return (
          candidate.between?.[0] === between[0] &&
          candidate.between[1] === between[1] &&
          window[0] <= date &&
          date <= window[1]
        );
      })
      .sort(byAuthored)
      .map((candidate) => candidate.placeId)
      .filter((place, index, all) => all.indexOf(place) === index && place !== visit.placeId);
  for (const visit of standalone) {
    if (!closed(visit) || visit.between) continue;
    if (visit.from && !homeIds.has(visit.from)) continue;
    const [start, end] = dateBounds(visit);
    const point = at(visit.placeId);
    const out = homeAt(homes, start);
    const back = homeAt(homes, end);
    const group = `place:${visit.placeId}`;
    const there = out ? passed(visit, [out.id, visit.placeId], [addDays(start, -1), start]) : [];
    const home = back ? passed(visit, [visit.placeId, back.id], [end, addDays(end, 1)]) : [];
    const key = `${group}|${out?.id ?? ""}|${back?.id ?? ""}|${there.join(",")}|${home.join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      if (out && !samePoint(out.coordinates, point))
        through(group, "leg", out.coordinates, point, 1, there);
      if (back && !samePoint(back.coordinates, point))
        through(group, "leg", point, back.coordinates, 1, home);
    }
    if (isStay(visit))
      excursions(
        group,
        standalone.filter((candidate) => covers(visit, dateBounds(candidate)[0])),
        new Set([visit.placeId]),
      );
  }
  return { trips, routes: { type: "FeatureCollection", features } };
}
