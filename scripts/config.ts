import { createHash } from "node:crypto";
import { z } from "zod";
import { placeKey } from "../src/map/place-key.ts";
import { slug as toSlug } from "../src/map/text.ts";
import { dateBounds } from "../src/map/time.ts";
export { dateBounds };

// Assigned ISO 3166-1 codes plus Natural Earth's documented XK territory identifier.
const countries: Record<string, true> = Object.fromEntries(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
    .split(" ")
    .map((code) => [code, true]),
);
countries.XK = true;
/** Every country code the schema accepts. */
export const countryCodes: readonly string[] = Object.keys(countries);
const countrySchema = z
  .string({
    error: (issue) =>
      issue.input === undefined
        ? "country is required"
        : "country must be an assigned ISO 3166-1 alpha-2 code",
  })
  .refine(
    (value) => countries[value] === true,
    "country must be an assigned ISO 3166-1 alpha-2 code",
  );
const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const text = z.string().trim().min(1);
const precisionSchema = z.enum(["city", "exact"]);

const dayBefore = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
const isoDate = z.string().refine(realDate, "date must be a real ISO date");
const rangeEndpoint = z.union([z.literal(""), isoDate]);
export const visitSchema = z
  .strictObject({
    id: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "id must be a stable lowercase slug",
      )
      .optional(),
    label: text.optional(),
    country: countrySchema,
    region: text.optional(),
    city: text.optional(),
    address: text.optional(),
    coordinates: coordinatesSchema.optional(),
    date: isoDate.optional(),
    dateRange: z.tuple([rangeEndpoint, rangeEndpoint]).optional(),
    publishPrecision: precisionSchema.optional(),
    // Optional public journey label; visits sharing it form one journey regardless of gaps.
    trip: text.optional(),
  })
  .superRefine((visit, context) => {
    if (
      visit.region &&
      /^[A-Z]{2}-/.test(visit.region) &&
      !visit.region.startsWith(`${visit.country}-`)
    )
      context.addIssue({
        code: "custom",
        path: ["region"],
        message: `region ${visit.region} does not belong to ${visit.country}`,
      });
    if (visit.date !== undefined && visit.dateRange !== undefined)
      context.addIssue({
        code: "custom",
        path: ["dateRange"],
        message: "use date or dateRange, not both",
      });
    if (visit.dateRange && dateBounds(visit)[0] > dateBounds(visit)[1])
      context.addIssue({
        code: "custom",
        path: ["dateRange"],
        message: "dateRange start must not be after end",
      });
  });
// Home is the base journeys leave from and return to. It is also a place lived
// in, so it lights its region and counts among the places; it is never a trip.
// Published at city precision only; `since` starts it, and the next home ends it.
export const homeSchema = z.strictObject({
  label: text.optional(),
  country: countrySchema,
  region: text.optional(),
  city: text,
  since: isoDate.optional(),
});
export const configSchema = z
  .strictObject({
    publishPrecision: precisionSchema.optional(),
    home: z.union([homeSchema, z.array(homeSchema).min(1)]).optional(),
    visits: z.array(visitSchema),
  })
  .superRefine((config, context) => {
    const homes = config.home === undefined ? [] : [config.home].flat();
    const starts = homes.map((home) => home.since ?? "");
    if (new Set(starts).size !== starts.length)
      context.addIssue({
        code: "custom",
        path: ["home"],
        message: "each home needs a distinct since date; only the first may omit it",
      });
    const ids = new Set<string>();
    config.visits.forEach((visit, index) => {
      if (visit.id && ids.has(visit.id))
        context.addIssue({
          code: "custom",
          path: ["visits", index, "id"],
          message: `duplicate id: ${visit.id}`,
        });
      if (visit.id) ids.add(visit.id);
    });
  })
  .transform((config) => {
    const used = new Set(
      config.visits.flatMap((visit) => (visit.id ? [visit.id] : [])),
    );
    const occurrences = new Map<string, number>();
    const homes = (config.home === undefined ? [] : [config.home].flat())
      .slice()
      .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
    return {
      ...config,
      homes: homes.map((home, index) => {
        const next = homes[index + 1]?.since;
        const digest = createHash("sha256")
          .update(JSON.stringify([home.country, normalize(home.city), home.since ?? null]))
          .digest("hex");
        return {
          ...home,
          id: `home-${toSlug(home.city) || "home"}-${digest.slice(0, 8)}`,
          label: home.label ?? home.city,
          // A home ends the day before the next one begins.
          ...(next ? { until: dayBefore(next) } : {}),
        };
      }),
      visits: config.visits.map((visit) => {
        let id = visit.id;
        if (!id) {
          const identity = JSON.stringify([
            visit.country,
            normalize(visit.region ?? ""),
            normalize(visit.city ?? ""),
            (visit.publishPrecision ?? config.publishPrecision) === "exact"
              ? (visit.coordinates ?? null)
              : null,
            ...dateBounds(visit),
          ]);
          const digest = createHash("sha256").update(identity).digest("hex");
          const slug = toSlug(visit.city ?? visit.region ?? visit.country);
          // Eight hex characters keep links short; the occurrence loop below resolves collisions.
          const base = `${visit.country.toLowerCase()}-${slug || "place"}-${digest.slice(0, 8)}`;
          let occurrence = occurrences.get(base) ?? 0;
          do {
            occurrence += 1;
            id = occurrence === 1 ? base : `${base}-${occurrence}`;
          } while (used.has(id));
          occurrences.set(base, occurrence);
          used.add(id);
        }
        return {
          ...visit,
          id,
          label: visit.label ?? visit.city ?? visit.region ?? visit.country,
        };
      }),
    };
  });
export type Config = z.input<typeof configSchema>;
export type ValidatedConfig = z.output<typeof configSchema>;
export type Visit = ValidatedConfig["visits"][number];
export type Home = ValidatedConfig["homes"][number];
/** The public home record: city-precision coordinates and the period it covers. */
export type PublicHome = {
  id: string;
  label: string;
  country: string;
  city: string;
  coordinates: [number, number];
  since?: string;
  until?: string;
};
export type ResolvedVisit = Visit;

export const cacheSchema = z.record(
  z.string().regex(/^[a-f0-9]{64}$/),
  z.strictObject({
    coordinates: coordinatesSchema,
    kind: z.enum(["city", "address"]),
    country: countrySchema,
    region: z
      .string()
      .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)
      .optional(),
    city: text.optional(),
    // Internal provenance is deliberately excluded from all public output.
    source: z.string().url().optional(),
  }),
);
export type Cache = z.infer<typeof cacheSchema>;
export type PublicVisit = Pick<
  Visit,
  "id" | "label" | "country" | "region" | "city" | "date" | "dateRange"
> & { coordinates: [number, number]; visitCount?: number };
export type Place = PublicVisit & { visitCount: number };
export type QueryKind = "city" | "address";
export type GeocodeQuery = { q: string; countrycodes: string; kind: QueryKind };
const normalize = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function buildQuery(
  visit: Pick<Visit, "country" | "region" | "city" | "address">,
  kind: QueryKind,
): GeocodeQuery {
  const parts = [
    kind === "address" ? visit.address : undefined,
    visit.city,
    visit.region,
    visit.country,
  ];
  return {
    q: parts
      .filter((part): part is string => Boolean(part))
      .map(normalize)
      .join(", "),
    countrycodes: visit.country.toLowerCase(),
    kind,
  };
}
export function queryKey(query: GeocodeQuery): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        q: normalize(query.q),
        countrycodes: query.countrycodes.toLowerCase(),
        kind: query.kind,
      }),
    )
    .digest("hex");
}
export function validateConfig(input: unknown, cache?: Cache): ValidatedConfig {
  const config = configSchema.parse(input);
  if (cache !== undefined) {
    const parsed = cacheSchema.parse(cache);
    resolveVisits(config, parsed);
    resolveHomes(config, parsed);
  }
  return config;
}
function cached(
  visit: Visit,
  cache: Cache,
  kind: QueryKind,
): Cache[string] | undefined {
  const entry = cache[queryKey(buildQuery(visit, kind))];
  if (!entry) return undefined;
  if (
    entry.kind !== kind ||
    entry.country !== visit.country ||
    (entry.region && !entry.region.startsWith(`${visit.country}-`)) ||
    (visit.region &&
      /^[A-Z]{2}-/.test(visit.region) &&
      entry.region &&
      visit.region !== entry.region)
  ) {
    throw new Error(
      `geocache location mismatch for ${visit.id}; remove its cache entry and run npm run geocode`,
    );
  }
  return entry;
}
function missing(visit: Visit): never {
  throw new Error(
    `geocache miss for ${visit.id}; run npm run geocode or add explicit coordinates with publishPrecision: 'exact' for a deliberate public landmark`,
  );
}
export function resolveVisits(
  config: Pick<ValidatedConfig, "visits" | "publishPrecision">,
  cache: Cache,
): ResolvedVisit[] {
  return config.visits.map((visit) => {
    // Country- and region-only records remain boundary visits, never city pins.
    if (!visit.city && !visit.address) return { ...visit };
    const exact =
      (visit.publishPrecision ?? config.publishPrecision ?? "city") === "exact";
    if (exact && visit.coordinates)
      return {
        ...visit,
        coordinates: [...visit.coordinates] as [number, number],
      };
    const address = visit.address ? cached(visit, cache, "address") : undefined;
    const city = visit.city ?? address?.city;
    const cityRegion = visit.region ?? address?.region;
    const cityVisit = {
      ...visit,
      ...(city ? { city } : {}),
      ...(cityRegion ? { region: cityRegion } : {}),
    };
    const cityEntry = city ? cached(cityVisit, cache, "city") : undefined;
    const coordinates = exact
      ? (visit.coordinates ?? address?.coordinates ?? cityEntry?.coordinates)
      : cityEntry?.coordinates;
    if (!coordinates) missing(visit);
    if (!exact && !city)
      throw new Error(
        `city precision for ${visit.id} requires a resolved city; add city and run npm run geocode or explicitly set publishPrecision: 'exact'`,
      );
    return {
      ...visit,
      ...(city ? { city } : {}),
      coordinates: [...coordinates] as [number, number],
    };
  });
}
/**
 * The visit record each home contributes: the home city for the whole period
 * it was home, under the home's own ID so the ring and the place are one.
 * It joins the ordinary visits for region discovery, places and totals, but
 * an open-ended range never joins a journey and never earns a leg.
 */
export function homeVisits(config: Pick<ValidatedConfig, "homes">): Visit[] {
  return config.homes.map((home) => ({
    id: home.id,
    label: home.label,
    country: home.country,
    ...(home.region ? { region: home.region } : {}),
    city: home.city,
    ...(home.since || home.until
      ? { dateRange: [home.since ?? "", home.until ?? ""] as [string, string] }
      : {}),
  }));
}
/** Homes resolve through the warm city cache only; they never publish finer than a city. */
export function resolveHomes(config: ValidatedConfig, cache: Cache): PublicHome[] {
  return config.homes.map((home) => {
    const entry = cached(home as unknown as Visit, cache, "city");
    if (!entry)
      throw new Error(
        `geocache miss for ${home.id} (home ${home.city}); run npm run geocode`,
      );
    return {
      id: home.id,
      label: home.label,
      country: home.country,
      city: home.city,
      coordinates: [...entry.coordinates] as [number, number],
      ...(home.since ? { since: home.since } : {}),
      ...(home.until ? { until: home.until } : {}),
    };
  });
}
export function publicVisit(
  visit: ResolvedVisit & { coordinates: [number, number] },
): PublicVisit {
  return {
    id: visit.id,
    label: visit.label,
    country: visit.country,
    ...(visit.region ? { region: visit.region } : {}),
    ...(visit.city ? { city: visit.city } : {}),
    coordinates: [...visit.coordinates],
    ...(visit.city || visit.address ? { visitCount: 1 } : {}),
    ...(visit.date !== undefined ? { date: visit.date } : {}),
    ...(visit.dateRange !== undefined
      ? { dateRange: [...visit.dateRange] as [string, string] }
      : {}),
  };
}
export function collapseVisits(visits: ResolvedVisit[]): Place[] {
  const groups = new Map<
    string,
    (ResolvedVisit & { coordinates: [number, number] })[]
  >();
  for (const visit of visits) {
    if ((!visit.city && !visit.address) || !visit.coordinates) continue;
    const key = placeKey(visit);
    const group = groups.get(key) ?? [];
    group.push({ ...visit, coordinates: visit.coordinates });
    groups.set(key, group);
  }
  const places: Place[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        dateBounds(a)[0].localeCompare(dateBounds(b)[0]) ||
        a.id.localeCompare(b.id),
    );
    const first = group[0];
    const place: Place = { ...publicVisit(first), visitCount: group.length };
    const dated = group.filter(
      (visit) => visit.date !== undefined || visit.dateRange !== undefined,
    );
    delete place.date;
    delete place.dateRange;
    if (dated.length) {
      const starts = dated.map((visit) => dateBounds(visit)[0]);
      const ends = dated.map((visit) => dateBounds(visit)[1]);
      const start = starts.reduce((a, b) => (a < b ? a : b));
      const end = ends.reduce((a, b) => (a > b ? a : b));
      if (start === end && dated.every((visit) => visit.date !== undefined))
        place.date = start;
      else
        place.dateRange = [
          dated.some((visit) => visit.dateRange?.[0] === "") ? "" : start,
          dated.some((visit) => visit.dateRange?.[1] === "") ? "" : end,
        ];
    }
    places.push(place);
  }
  return places.sort(
    (a, b) =>
      dateBounds(a)[0].localeCompare(dateBounds(b)[0]) ||
      a.id.localeCompare(b.id),
  );
}
