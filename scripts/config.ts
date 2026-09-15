import { createHash } from 'node:crypto';
import { z } from 'zod';
import {placeKey} from '../src/map/place-key.ts';

// Assigned ISO 3166-1 codes plus Natural Earth's documented XK territory identifier.
const countries: Record<string, true> = Object.fromEntries(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ').map(code => [code, true]));
countries.XK=true;
const countrySchema = z.string({ error: issue => issue.input === undefined ? 'country is required' : 'country must be an assigned ISO 3166-1 alpha-2 code' }).refine(value => countries[value] === true, 'country must be an assigned ISO 3166-1 alpha-2 code');
const coordinatesSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const text = z.string().trim().min(1);
const precisionSchema = z.enum(['city', 'exact']);

function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
const isoDate = z.string().refine(realDate, 'date must be a real ISO date');
const rangeEndpoint = z.union([z.literal(''), isoDate]);
export const visitSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be a stable lowercase slug'),
  label: text,
  country: countrySchema,
  region: text.optional(),
  city: text.optional(),
  address: text.optional(),
  coordinates: coordinatesSchema.optional(),
  date: isoDate.optional(),
  dateRange: z.tuple([rangeEndpoint, rangeEndpoint]).optional(),
  tags: z.array(text).optional(),
  publishPrecision: precisionSchema.optional(),
}).superRefine((visit, context) => {
  if (visit.region && /^[A-Z]{2}-/.test(visit.region) && !visit.region.startsWith(`${visit.country}-`)) context.addIssue({ code: 'custom', path: ['region'], message: `region ${visit.region} does not belong to ${visit.country}` });
  if (visit.date !== undefined && visit.dateRange !== undefined) context.addIssue({ code: 'custom', path: ['dateRange'], message: 'use date or dateRange, not both' });
  if (visit.dateRange && dateBounds(visit)[0] > dateBounds(visit)[1]) context.addIssue({ code: 'custom', path: ['dateRange'], message: 'dateRange start must not be after end' });
});
export const configSchema = z.strictObject({
  publishPrecision: precisionSchema.optional(),
  visits: z.array(visitSchema),
}).superRefine((config, context) => {
  const ids = new Set<string>();
  config.visits.forEach((visit, index) => {
    if (ids.has(visit.id)) context.addIssue({ code: 'custom', path: ['visits', index, 'id'], message: `duplicate id: ${visit.id}` });
    ids.add(visit.id);
  });
});
export type Visit = z.infer<typeof visitSchema>;
export type Config = z.infer<typeof configSchema>;
export type ResolvedVisit = Visit;

export const cacheSchema = z.record(z.string().regex(/^[a-f0-9]{64}$/), z.strictObject({
  coordinates: coordinatesSchema,
  kind: z.enum(['city', 'address']),
  country: countrySchema,
  region: z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/).optional(),
  city: text.optional(),
  // Internal provenance is deliberately excluded from all public output.
  source: z.string().url().optional(),
}));
export type Cache = z.infer<typeof cacheSchema>;
export type PublicVisit = Pick<Visit, 'id' | 'label' | 'country' | 'region' | 'city' | 'date' | 'dateRange' | 'tags'> & { coordinates: [number, number] };
export type Place = PublicVisit & { visitCount: number };
export type QueryKind = 'city' | 'address';
export type GeocodeQuery = { q: string; countrycodes: string; kind: QueryKind };
const normalize = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function buildQuery(visit: Pick<Visit, 'country' | 'region' | 'city' | 'address'>, kind: QueryKind): GeocodeQuery {
  const parts = [kind === 'address' ? visit.address : undefined, visit.city, visit.region, visit.country];
  return { q: parts.filter((part): part is string => Boolean(part)).map(normalize).join(', '), countrycodes: visit.country.toLowerCase(), kind };
}
export function queryKey(query: GeocodeQuery): string {
  return createHash('sha256').update(JSON.stringify({ q: normalize(query.q), countrycodes: query.countrycodes.toLowerCase(), kind: query.kind })).digest('hex');
}
export function dateBounds(value: { date?: string; dateRange?: [string, string] }): [string, string] {
  if (value.date) return [value.date, value.date];
  return [value.dateRange?.[0] || '0001-01-01', value.dateRange?.[1] || '9999-12-31'];
}
export function validateConfig(input: unknown, cache?: Cache): Config {
  const config = configSchema.parse(input);
  if (cache !== undefined) resolveVisits(config, cacheSchema.parse(cache));
  return config;
}
function cached(visit: Visit, cache: Cache, kind: QueryKind): Cache[string] | undefined {
  const entry = cache[queryKey(buildQuery(visit, kind))];
  if (!entry) return undefined;
  if (entry.kind !== kind || entry.country !== visit.country || (entry.region && !entry.region.startsWith(`${visit.country}-`)) || (visit.region && /^[A-Z]{2}-/.test(visit.region) && entry.region && visit.region !== entry.region)) {
    throw new Error(`geocache location mismatch for ${visit.id}; remove its cache entry and run npm run geocode`);
  }
  return entry;
}
function missing(visit: Visit): never {
  throw new Error(`geocache miss for ${visit.id}; run npm run geocode or add explicit coordinates`);
}
export function resolveVisits(config: Config, cache: Cache): ResolvedVisit[] {
  return config.visits.map(visit => {
    // Country- and region-only records remain boundary visits, never city pins.
    if (!visit.city && !visit.address) return { ...visit };
    const exact = (visit.publishPrecision ?? config.publishPrecision ?? 'city') === 'exact';
    if (exact && visit.coordinates) return { ...visit, coordinates: [...visit.coordinates] as [number, number] };
    const address = visit.address ? cached(visit, cache, 'address') : undefined;
    const city = visit.city ?? address?.city;
    const cityVisit = { ...visit, ...(city ? { city } : {}) };
    const cityEntry = city ? cached(cityVisit, cache, 'city') : undefined;
    const coordinates = exact
      ? visit.coordinates ?? address?.coordinates ?? cityEntry?.coordinates
      : cityEntry?.coordinates;
    if (!coordinates) missing(visit);
    if (!exact && !city) throw new Error(`city precision for ${visit.id} requires a resolved city; add city and run npm run geocode or explicitly set publishPrecision: 'exact'`);
    const region = visit.region ?? cityEntry?.region ?? address?.region;
    return { ...visit, ...(city ? { city } : {}), ...(region ? { region } : {}), coordinates: [...coordinates] as [number, number] };
  });
}
export function publicVisit(visit: ResolvedVisit & { coordinates: [number, number] }): PublicVisit {
  return {
    id: visit.id, label: visit.label, country: visit.country,
    ...(visit.region ? { region: visit.region } : {}),
    ...(visit.city ? { city: visit.city } : {}),
    coordinates: [...visit.coordinates],
    ...(visit.date !== undefined ? { date: visit.date } : {}),
    ...(visit.dateRange !== undefined ? { dateRange: [...visit.dateRange] as [string, string] } : {}),
    ...(visit.tags !== undefined ? { tags: [...visit.tags] } : {}),
  };
}
export function collapseVisits(visits: ResolvedVisit[]): Place[] {
  const groups = new Map<string, (ResolvedVisit & { coordinates: [number, number] })[]>();
  for (const visit of visits) {
    if ((!visit.city && !visit.address) || !visit.coordinates) continue;
    const key = placeKey(visit);
    const group = groups.get(key) ?? [];
    group.push({ ...visit, coordinates: visit.coordinates });
    groups.set(key, group);
  }
  const places: Place[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => dateBounds(a)[0].localeCompare(dateBounds(b)[0]) || a.id.localeCompare(b.id));
    const first = group[0];
    const place: Place = { ...publicVisit(first), visitCount: group.length };
    const dated = group.filter(visit => visit.date !== undefined || visit.dateRange !== undefined);
    delete place.date;
    delete place.dateRange;
    if (dated.length) {
      const starts = dated.map(visit => dateBounds(visit)[0]);
      const ends = dated.map(visit => dateBounds(visit)[1]);
      const start = starts.reduce((a, b) => a < b ? a : b);
      const end = ends.reduce((a, b) => a > b ? a : b);
      if (start === end && dated.every(visit => visit.date !== undefined)) place.date = start;
      else place.dateRange = [dated.some(visit => visit.dateRange?.[0] === '') ? '' : start, dated.some(visit => visit.dateRange?.[1] === '') ? '' : end];
    }
    const tags = [...new Set(group.flatMap(visit => visit.tags ?? []))].sort();
    if (tags.length) place.tags = tags;
    else delete place.tags;
    places.push(place);
  }
  return places.sort((a, b) => dateBounds(a)[0].localeCompare(dateBounds(b)[0]) || a.id.localeCompare(b.id));
}
