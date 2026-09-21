import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import authoredConfig from "../data/visits.ts";
import {
  buildQuery,
  cacheSchema,
  queryKey,
  validateConfig,
  type Cache,
  type Config,
  type QueryKind,
  type Visit,
} from "./config.ts";

const cachePath = new URL("../data/geocache.json", import.meta.url);
const resultSchema = z.object({
  lat: z.string(),
  lon: z.string(),
  importance: z.number().optional(),
  display_name: z.string(),
  name: z.string().optional(),
  addresstype: z.string().optional(),
  address: z.record(z.string(), z.string()),
});
type Candidate = z.infer<typeof resultSchema>;
const settlements: Record<string, true> = {
  city: true,
  town: true,
  village: true,
  municipality: true,
  hamlet: true,
};
const normalized = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const cityName = (candidate: Candidate): string | undefined =>
  candidate.address.city ??
  candidate.address.town ??
  candidate.address.village ??
  candidate.address.hamlet ??
  candidate.address.municipality ??
  (settlements[candidate.addresstype ?? ""] === true
    ? candidate.name
    : undefined);
const regionCode = (candidate: Candidate): string | undefined =>
  candidate.address["ISO3166-2-lvl4"] ??
  candidate.address["ISO3166-2-lvl3"] ??
  candidate.address["ISO3166-2-lvl6"];

function ambiguity(visit: Visit, reason: string): never {
  throw new Error(
    `geocoding ${visit.id}: ${reason}; add a city/region to disambiguate, or add explicit coordinates and publishPrecision: 'exact' to this visit`,
  );
}

// Explicit author action only. Builds import config.ts, never this network-capable module.
export async function geocodeConfig(
  config: Config,
  cache: Cache,
): Promise<Cache> {
  let lastRequest = 0;
  async function lookup(visit: Visit, kind: QueryKind): Promise<Cache[string]> {
    const query = buildQuery(visit, kind);
    const key = queryKey(query);
    const existing = cache[key];
    if (existing) return existing;
    const contact = process.env.NOMINATIM_CONTACT?.trim();
    if (!contact || /[\r\n]/.test(contact))
      throw new Error(
        "Set NOMINATIM_CONTACT to your email or project contact URL before running live geocoding",
      );
    await delay(Math.max(0, 1100 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/search");
    // ISO subdivision codes are filters, not Nominatim place-name tokens.
    // Including DE-HH in q returns POIs instead of the city of Hamburg.
    const searchText = [
      kind === "address" ? visit.address : undefined,
      visit.city,
      visit.region && !/^[A-Z]{2}-/.test(visit.region)
        ? visit.region
        : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    url.search = new URLSearchParams({
      q: searchText,
      countrycodes: query.countrycodes,
      format: "jsonv2",
      addressdetails: "1",
      limit: "5",
      "accept-language": "en",
    }).toString();
    const response = await fetch(url, {
      headers: {
        "User-Agent": `AtlasOfALife/1.0 (build-time personal travel atlas geocoder; contact: ${contact})`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `geocoding ${visit.id}: Nominatim HTTP ${response.status}; cache was not changed`,
      );
    const candidates = z
      .array(resultSchema)
      .parse(await response.json())
      .filter((candidate) => {
        if (candidate.address.country_code?.toUpperCase() !== visit.country)
          return false;
        if (
          kind === "city" &&
          settlements[candidate.addresstype ?? ""] !== true
        )
          return false;
        const region = regionCode(candidate);
        if (!visit.region) return true;
        if (/^[A-Z]{2}-/.test(visit.region))
          return !region || region === visit.region;
        return [
          candidate.address.state,
          candidate.address.province,
          candidate.address.region,
          candidate.address.county,
        ].some(
          (name) => name && normalized(name) === normalized(visit.region!),
        );
      })
      .map((candidate) => ({
        candidate,
        score:
          (candidate.importance ?? 0) +
          (visit.city &&
          normalized(cityName(candidate) ?? "") === normalized(visit.city)
            ? 0.25
            : 0),
      }))
      .sort((a, b) => b.score - a.score);
    if (!candidates.length)
      ambiguity(visit, "no result in the requested country/region");
    if (candidates[1] && candidates[0].score - candidates[1].score < 0.05)
      ambiguity(visit, "ambiguous results (confidence gap below 0.05)");
    const chosen = candidates[0].candidate;
    const coordinates: [number, number] = [
      Number(chosen.lon),
      Number(chosen.lat),
    ];
    const region = regionCode(chosen);
    const city = cityName(chosen);
    const entry: Cache[string] = {
      coordinates,
      kind,
      country: visit.country,
      ...(region ? { region } : {}),
      ...(city ? { city } : {}),
      source: url.href,
    };
    // Validate upstream coordinates and codes before they can enter the warm cache.
    cacheSchema.parse({ [key]: entry });
    cache[key] = entry;
    return entry;
  }
  for (const visit of config.visits) {
    if (!visit.city && !visit.address) continue;
    const exact =
      (visit.publishPrecision ?? config.publishPrecision ?? "city") === "exact";
    // Explicit exact coordinates do not require geocoding or disclose an address.
    if (exact && visit.coordinates) continue;
    let address = visit.address
      ? cache[queryKey(buildQuery(visit, "address"))]
      : undefined;
    if (visit.address && (exact || !visit.city))
      address ??= await lookup(visit, "address");
    const city = visit.city ?? address?.city;
    const region = visit.region ?? address?.region;
    // Keep the address's administrative context when snapping a same-named city.
    if (!exact && city)
      await lookup({ ...visit, city, ...(region ? { region } : {}) }, "city");
    else if (!visit.address && !visit.coordinates) await lookup(visit, "city");
    else if (!exact && !city)
      ambiguity(
        visit,
        "address result has no city for city-precision publication",
      );
  }
  validateConfig(config, cache);
  return cache;
}
async function main(): Promise<void> {
  const config = validateConfig(authoredConfig);
  let cache: Cache;
  try {
    cache = cacheSchema.parse(
      JSON.parse(await readFile(cachePath, "utf8")) as unknown,
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      cache = {};
    else throw error;
  }
  await geocodeConfig(config, cache);
  const sorted = Object.fromEntries(
    Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(cachePath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(
    `Geocache ready: ${Object.keys(cache).length} entries. Normal builds remain offline.`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
