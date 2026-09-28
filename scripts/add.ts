import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import authoredConfig from "../data/visits.ts";
import { buildQuery, cacheSchema, queryKey, validateConfig, type Cache } from "./config.ts";
import { geocodeConfig } from "./geocode.ts";
import { duplicateOf, insertVisit, parseVisitArgs, type AuthoredVisit } from "./authoring.ts";

export const configPath = fileURLToPath(new URL("../data/visits.ts", import.meta.url));
export const cachePath = fileURLToPath(new URL("../data/geocache.json", import.meta.url));

/** Appends the visits to data/visits.ts, then warms the geocache for them. */
export async function commitVisits(
  visits: AuthoredVisit[],
  options: { dryRun: boolean; geocode: boolean },
): Promise<void> {
  let source = await readFile(configPath, "utf8");
  for (const visit of visits) source = insertVisit(source, visit);
  if (options.dryRun) {
    console.log(source.slice(source.length - Math.min(source.length, 600 + 200 * visits.length)));
    console.log("Dry run: data/visits.ts unchanged.");
    return;
  }
  await writeFile(configPath, source);
  console.log(`Added ${visits.length} ${visits.length === 1 ? "visit" : "visits"} to data/visits.ts`);
  if (!options.geocode) {
    console.log("Skipped geocoding; run NOMINATIM_CONTACT=you@example.org npm run geocode before building.");
    return;
  }
  let cache: Cache = {};
  try {
    cache = cacheSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const config = validateConfig({ ...authoredConfig, visits: [...authoredConfig.visits, ...visits] });
  await geocodeConfig(config, cache);
  await writeFile(
    cachePath,
    `${JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`,
  );
  for (const visit of config.visits.slice(-visits.length)) {
    const entry = cache[queryKey(buildQuery(visit, "city"))];
    console.log(
      `${visit.id}: ${visit.city}, ${visit.country} → ${entry ? `${entry.coordinates[1]}, ${entry.coordinates[0]}${entry.region ? ` (${entry.region})` : ""}` : "no city result"}`,
    );
  }
  console.log("Next: npm run build, then commit data/visits.ts, data/geocache.json and data/sources.json.");
}

async function main() {
  const { visit, dryRun, geocode } = parseVisitArgs(process.argv.slice(2));
  const existing = duplicateOf(authoredConfig, visit);
  if (existing)
    throw new Error(`Refusing a duplicate: ${existing.city}, ${existing.country} with the same dates already exists`);
  await commitVisits([visit], { dryRun, geocode });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
