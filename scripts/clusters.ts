import { fold } from "../src/map/text.ts";
import type { AuthoredVisit } from "./authoring.ts";

/**
 * Pure reduction of photo metadata to visits. Photos are never the unit: each
 * one collapses to its local date plus the city the photo library already
 * attached, those city-days are filtered for substance, and only runs of them
 * become stays or day trips. Nothing here reads a file or the network.
 */
export type PhotoPoint = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local time of day, HH:MM, when the source carries it. */
  time?: string;
  latitude?: number;
  longitude?: number;
  /** ISO 3166-1 alpha-2 code the library attached, when it knew one. */
  country?: string;
  /** Settlement name the library attached, when it knew one. */
  city?: string;
  albums?: string[];
};

export type Home = { country: string; city: string; coordinates?: [number, number] };
export type ClusterOptions = {
  /** Every home the atlas has had; photos at home are everyday life, not visits. */
  homes?: Home[];
  /** Photos within this distance of the home point are everyday life, not a visit. */
  homeRadiusKm: number;
  /** A city-day counts with at least this many photos … */
  minPhotos: number;
  /** … or with photos spread over at least this many minutes. */
  minSpanMinutes: number;
  /** A lone qualifying day needs this many photos to be a visit on its own. */
  dayTripMinPhotos: number;
  /** Days without photos a stay may bridge before it splits in two. */
  maxGapDays: number;
  /** Unnamed photos join a named city-day of the same date within this distance. */
  mergeKm: number;
};

export const defaultClusterOptions: ClusterOptions = {
  homeRadiusKm: 25,
  minPhotos: 5,
  minSpanMinutes: 120,
  dayTripMinPhotos: 10,
  maxGapDays: 1,
  mergeKm: 15,
};

export type CityDay = {
  date: string;
  country: string;
  city: string;
  photos: number;
  /** Minutes between the first and last timed photo; 0 without times. */
  spanMinutes: number;
  albums: Map<string, number>;
  /** Mean of the located photos, for the rare reverse lookup. */
  point?: [number, number];
};

export type ProposedVisit = AuthoredVisit & {
  photos: number;
  /** Album most of the photos share, offered as a trip name, never written unasked. */
  album?: string;
  /** Representative point, kept out of every file the repository commits. */
  point?: [number, number];
};

export type ClusterResult = {
  visits: ProposedVisit[];
  /** Qualifying or not, the city-days that became no visit. */
  passedThrough: CityDay[];
  dropped: { home: number; unnamed: number; undated: number };
  /** Newest photo date seen, for the next incremental run. */
  lastDate?: string;
};

const EARTH_RADIUS_KM = 6371;
/** Great-circle distance between two [longitude, latitude] points. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
/** The component-wise median of the located photos: a point inside the day, independent of photo order. */
const representative = (bucket: { longitudes: readonly number[]; latitudes: readonly number[] }): [number, number] | undefined =>
  bucket.longitudes.length ? [median(bucket.longitudes), median(bucket.latitudes)] : undefined;
const minutes = (time: string | undefined): number | undefined => {
  const match = time?.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
};
const located = (photo: PhotoPoint): photo is PhotoPoint & { latitude: number; longitude: number } =>
  Number.isFinite(photo.latitude) && Number.isFinite(photo.longitude);
const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

type DayBucket = CityDay & {
  spellings: Map<string, number>;
  first?: number;
  last?: number;
  longitudes: number[];
  latitudes: number[];
};

function isHome(photo: PhotoPoint, options: ClusterOptions): boolean {
  return (options.homes ?? []).some(
    (home) =>
      (photo.country === home.country && photo.city && fold(photo.city) === fold(home.city)) ||
      (home.coordinates &&
        located(photo) &&
        distanceKm([photo.longitude, photo.latitude], home.coordinates) <= options.homeRadiusKm),
  );
}

/** Groups photos into city-days, naming unnamed photos after a nearby named one of the same date. */
export function cityDays(
  photos: readonly PhotoPoint[],
  options: ClusterOptions = defaultClusterOptions,
): { days: CityDay[]; dropped: ClusterResult["dropped"]; lastDate?: string } {
  const dropped = { home: 0, unnamed: 0, undated: 0 };
  const buckets = new Map<string, DayBucket>();
  const unnamed: PhotoPoint[] = [];
  let lastDate: string | undefined;
  const add = (bucket: DayBucket, photo: PhotoPoint) => {
    bucket.photos += 1;
    if (photo.city) bucket.spellings.set(photo.city, (bucket.spellings.get(photo.city) ?? 0) + 1);
    for (const album of photo.albums ?? []) bucket.albums.set(album, (bucket.albums.get(album) ?? 0) + 1);
    const at = minutes(photo.time);
    if (at !== undefined) {
      bucket.first = bucket.first === undefined ? at : Math.min(bucket.first, at);
      bucket.last = bucket.last === undefined ? at : Math.max(bucket.last, at);
    }
    if (located(photo)) {
      bucket.longitudes.push(photo.longitude);
      bucket.latitudes.push(photo.latitude);
    }
  };
  for (const photo of photos) {
    if (!isoDate.test(photo.date)) {
      dropped.undated += 1;
      continue;
    }
    if (!lastDate || photo.date > lastDate) lastDate = photo.date;
    if (isHome(photo, options)) {
      dropped.home += 1;
      continue;
    }
    if (!photo.country || !photo.city) {
      unnamed.push(photo);
      continue;
    }
    const key = `${photo.date}|${photo.country}|${fold(photo.city)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        date: photo.date,
        country: photo.country,
        city: photo.city,
        photos: 0,
        spanMinutes: 0,
        albums: new Map(),
        spellings: new Map(),
        longitudes: [],
        latitudes: [],
      };
      buckets.set(key, bucket);
    }
    add(bucket, photo);
  }
  // Second pass: an unnamed photo joins the nearest named city-day of its date.
  const byDate = new Map<string, DayBucket[]>();
  for (const bucket of buckets.values()) {
    const list = byDate.get(bucket.date) ?? [];
    list.push(bucket);
    byDate.set(bucket.date, list);
  }
  for (const photo of unnamed) {
    let nearest: DayBucket | undefined;
    let best = options.mergeKm;
    if (located(photo))
      for (const bucket of byDate.get(photo.date) ?? []) {
        const centre = representative(bucket);
        if (!centre) continue;
        const d = distanceKm([photo.longitude, photo.latitude], centre);
        if (d <= best) {
          best = d;
          nearest = bucket;
        }
      }
    if (nearest) add(nearest, photo);
    else dropped.unnamed += 1;
  }
  const days = [...buckets.values()]
    .map(({ spellings, first, last, longitudes, latitudes, ...day }): CityDay => {
      // The most frequent spelling names the day; ties fall to the alphabetically first.
      const city = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? day.city;
      return {
        ...day,
        city,
        spanMinutes: first !== undefined && last !== undefined ? last - first : 0,
        point: representative({ longitudes, latitudes }),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country) || fold(a.city).localeCompare(fold(b.city)));
  return { days, dropped, lastDate };
}

const qualifies = (day: CityDay, options: ClusterOptions): boolean =>
  day.photos >= options.minPhotos || (day.spanMinutes > 0 && day.spanMinutes >= options.minSpanMinutes);

/** The album most photos of the run share, when it is a real majority. */
function sharedAlbum(days: readonly CityDay[]): string | undefined {
  const counts = new Map<string, number>();
  let photos = 0;
  for (const day of days) {
    photos += day.photos;
    for (const [album, n] of day.albums) counts.set(album, (counts.get(album) ?? 0) + n);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top && top[1] * 2 > photos ? top[0] : undefined;
}

/** Reduces photos to proposed visits under the rules above. */
export function clusterPhotos(
  photos: readonly PhotoPoint[],
  options: ClusterOptions = defaultClusterOptions,
): ClusterResult {
  const { days, dropped, lastDate } = cityDays(photos, options);
  const passedThrough: CityDay[] = [];
  const byPlace = new Map<string, CityDay[]>();
  for (const day of days) {
    const key = `${day.country}|${fold(day.city)}`;
    const list = byPlace.get(key) ?? [];
    list.push(day);
    byPlace.set(key, list);
  }
  const visits: ProposedVisit[] = [];
  const stays: { start: string; end: string }[] = [];
  const singles: { day: CityDay; run: CityDay[] }[] = [];
  for (const run of byPlace.values()) {
    // Runs of city-days at one place, split where the gap exceeds the allowance. A
    // run needs one substantial day; the quiet days beside it are its arrival and
    // departure and stay in. A run with none is passed through whole.
    let current: CityDay[] = [];
    const flush = () => {
      if (!current.length) return;
      if (!current.some((day) => qualifies(day, options))) passedThrough.push(...current);
      else if (current.length > 1) {
        const start = current[0].date;
        const end = current[current.length - 1].date;
        stays.push({ start, end });
        visits.push(proposal(current, { dateRange: [start, end] }));
      } else singles.push({ day: current[0], run: current });
      current = [];
    };
    for (const day of run) {
      const previous = current[current.length - 1];
      if (previous && daysBetween(previous.date, day.date) > options.maxGapDays + 1) flush();
      current.push(day);
    }
    flush();
  }
  for (const { day, run } of singles) {
    const inside = stays.some((stay) => stay.start < day.date && day.date < stay.end);
    const edge = stays.some((stay) => stay.start === day.date || stay.end === day.date);
    // A lone day inside a stay is a day trip the build infers from the dates; on a
    // stay's arrival or departure day it must be marked, as a plain date would read
    // as a stop on the way. A lone day touching no stay stands on its own merits.
    if (inside || edge || day.photos >= options.dayTripMinPhotos)
      visits.push(proposal(run, { date: day.date, ...(edge && !inside ? { dayTrip: true as const } : {}) }));
    else passedThrough.push(day);
  }
  visits.sort((a, b) => (a.date ?? a.dateRange?.[0] ?? "").localeCompare(b.date ?? b.dateRange?.[0] ?? "") || a.country.localeCompare(b.country) || fold(a.city).localeCompare(fold(b.city)));
  // A quiet day inside a stay at the same place is part of the stay, not a place passed through.
  const covered = (day: CityDay) =>
    visits.some(
      (visit) =>
        visit.dateRange &&
        visit.country === day.country &&
        fold(visit.city) === fold(day.city) &&
        visit.dateRange[0] <= day.date &&
        day.date <= visit.dateRange[1],
    );
  const remaining = passedThrough
    .filter((day) => !covered(day))
    .sort((a, b) => a.date.localeCompare(b.date) || fold(a.city).localeCompare(fold(b.city)));
  return { visits, passedThrough: remaining, dropped, lastDate };
}

function proposal(run: readonly CityDay[], when: Pick<AuthoredVisit, "date" | "dateRange" | "dayTrip">): ProposedVisit {
  const photos = run.reduce((sum, day) => sum + day.photos, 0);
  // The run's most photographed day lends its spelling and its point.
  const busiest = [...run].sort((a, b) => b.photos - a.photos || a.date.localeCompare(b.date))[0];
  const album = sharedAlbum(run);
  return {
    country: run[0].country,
    city: busiest.city,
    ...when,
    photos,
    ...(album ? { album } : {}),
    ...(busiest.point ? { point: busiest.point } : {}),
  };
}

export type TripGroup = { start: string; end: string; visits: ProposedVisit[] };
/** Visits whose dates touch or overlap read as one trip, for the proposal's layout. */
export function groupTrips(visits: readonly ProposedVisit[]): TripGroup[] {
  const groups: TripGroup[] = [];
  const bounds = (visit: ProposedVisit): [string, string] =>
    visit.date ? [visit.date, visit.date] : [visit.dateRange![0], visit.dateRange![1]];
  for (const visit of [...visits].sort((a, b) => bounds(a)[0].localeCompare(bounds(b)[0]))) {
    const [start, end] = bounds(visit);
    const last = groups[groups.length - 1];
    if (last && start <= addDays(last.end, 1)) {
      last.visits.push(visit);
      if (end > last.end) last.end = end;
    } else groups.push({ start, end, visits: [visit] });
  }
  return groups;
}
