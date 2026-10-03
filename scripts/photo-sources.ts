import { parseCsv } from "./authoring.ts";
import type { PhotoPoint } from "./clusters.ts";

/**
 * Readers that turn photo metadata exports into PhotoPoints. Each yields the
 * local date, the point and whatever place name the library attached; nothing
 * else leaves the export. Only osxphotos output is read here, as the compact
 * `--field` form or the full `--json` record.
 */
export const osxphotosFields = [
  ["date", "{created.date}"],
  ["time", "{created.strftime,%H:%M}"],
  ["lat", "{photo.latitude}"],
  ["lon", "{photo.longitude}"],
  ["country", "{place.country_code}"],
  ["city", "{place.address.city}"],
  ["albums", "{album}"],
] as const;

type Loose = Record<string, unknown>;
const text = (value: unknown): string | undefined => {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  // osxphotos renders an empty template value as a lone underscore.
  return trimmed && trimmed !== "_" && trimmed !== "None" ? trimmed : undefined;
};
const number = (value: unknown): number | undefined => {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const list = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(text).filter((item): item is string => Boolean(item));
  const single = text(value);
  return single ? single.split(",").map((item) => item.trim()).filter(Boolean) : [];
};
const first = (value: unknown): string | undefined => (Array.isArray(value) ? text(value[0]) : text(value));

/** One osxphotos record, in either shape, to a PhotoPoint; undefined when it has no date. */
export function photoFromRecord(record: Loose): PhotoPoint | undefined {
  const stamp = text(record.date);
  if (!stamp) return undefined;
  const date = stamp.slice(0, 10);
  const time = text(record.time) ?? (stamp.length > 10 ? stamp.slice(11, 16) : undefined);
  const place = (record.place ?? {}) as Loose;
  const names = (place.names ?? {}) as Loose;
  const address = (place.address ?? {}) as Loose;
  const country = text(record.country) ?? text(place.country_code) ?? text(address.country_code);
  const city = text(record.city) ?? text(address.city) ?? first(names.city);
  const albums = list(record.albums);
  return {
    date,
    ...(time && /^\d{2}:\d{2}$/.test(time) ? { time } : {}),
    latitude: number(record.lat ?? record.latitude),
    longitude: number(record.lon ?? record.longitude),
    ...(country ? { country: country.toUpperCase() } : {}),
    ...(city ? { city } : {}),
    ...(albums.length ? { albums } : {}),
  };
}

/** Reads an osxphotos export: a JSON array, or the CSV `--field` prints without `--json`. */
export function readOsxphotos(contents: string): PhotoPoint[] {
  const trimmed = contents.trim();
  const records: Loose[] = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as Loose[])
    : parseCsv(contents).map((row) => row.fields);
  if (!Array.isArray(records)) throw new Error("Expected a JSON array of photo records");
  return records.map(photoFromRecord).filter((photo): photo is PhotoPoint => photo !== undefined);
}
