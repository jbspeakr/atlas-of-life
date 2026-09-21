import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import mapshaper from "mapshaper";
import authoredConfig from "../data/visits.ts";
import fixtureConfig from "../verification/fixtures/visits.ts";
import {
  cacheSchema,
  collapseVisits,
  publicVisit,
  resolveVisits,
  validateConfig,
} from "./config.ts";
import {
  BoundaryRepository,
  geometryMetadata,
  root,
  type Boundary,
  type Boundaries,
  type RawCollection,
} from "./boundaries.ts";

async function simplify(
  features: Boundary[],
  interval: number,
  quantization: number,
): Promise<Boundaries> {
  if (!features.length) return { type: "FeatureCollection", features: [] };
  const input = JSON.stringify({
    type: "FeatureCollection",
    features: features.map((feature) => ({
      ...feature,
      properties: {
        key: String(feature.id),
        country: feature.properties.country,
        ...(feature.properties.region
          ? { region: feature.properties.region }
          : {}),
        label: feature.properties.label,
      },
    })),
  });
  // Quantize a shared topology, not each polygon independently, to preserve common edges.
  const topology = await mapshaper.applyCommands(
    `-i input.geojson -simplify weighted interval=${interval} keep-shapes -o output.topojson format=topojson quantization=${quantization} fix-geometry`,
    { "input.geojson": input },
  );
  const output = await mapshaper.applyCommands(
    "-i output.topojson -o output.geojson format=geojson precision=0.00001",
    { "output.topojson": topology["output.topojson"] },
  );
  const data = JSON.parse(output["output.geojson"]) as RawCollection;
  const originals = new Map(
    features.map((feature) => [String(feature.id), feature]),
  );
  const reduced: Boundary[] = data.features.map((feature) => {
    const id = String(feature.properties.key);
    const original = originals.get(id);
    if (!original || !feature.geometry)
      throw new Error(`Simplification lost boundary identity: ${id}`);
    return {
      type: "Feature",
      id,
      geometry: feature.geometry,
      properties: {
        country: original.properties.country,
        ...(original.properties.region
          ? { region: original.properties.region }
          : {}),
        label: original.properties.label,
        ...geometryMetadata(feature.geometry),
      },
    };
  });
  if (reduced.length !== features.length)
    throw new Error("Simplification dropped a visited boundary");
  return {
    type: "FeatureCollection",
    features: reduced.sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

async function main(): Promise<void> {
  // Geocoding is intentionally offline: the only network-capable component is the boundary repository.
  const fixture = process.env.ATLAS_FIXTURE === "1";
  const cachePath = fixture
    ? "verification/fixtures/geocache.json"
    : "data/geocache.json";
  const cache = cacheSchema.parse(
    JSON.parse(await readFile(resolve(root, cachePath), "utf8")),
  );
  const authored = validateConfig(
    fixture ? fixtureConfig : authoredConfig,
    cache,
  );
  const resolved = resolveVisits(authored, cache);
  const repository = await BoundaryRepository.open();
  const countryCodes = [
    ...new Set(resolved.map((visit) => visit.country)),
  ].sort();
  const countries = await repository.countries(countryCodes);
  const regions: Boundary[] = [];
  for (const country of countryCodes) {
    const visits = resolved.filter((visit) => visit.country === country);
    const requests = visits.map((visit) => ({
      region: visit.region,
      coordinates: visit.city || visit.address ? visit.coordinates : undefined,
    }));
    const discovered = await repository.regions(
      country,
      countries.iso3.get(country)!,
      requests,
    );
    regions.push(...discovered.boundaries);
    for (const [index, visit] of visits.entries()) {
      const region = discovered.assignments[index];
      if (region) visit.region = region;
    }
  }
  const visitedRegionIds = new Set(
    resolved
      .map((visit) => visit.region)
      .filter((region): region is string => Boolean(region)),
  );
  const visitedRegions = regions.filter((feature) =>
    visitedRegionIds.has(String(feature.id)),
  );
  const countryCoarse = await simplify(countries.boundaries, 2000, 100_000);
  const countryFine = await simplify(countries.boundaries, 250, 1_000_000);
  const regionCoarse = await simplify(visitedRegions, 750, 100_000);
  const regionFine = await simplify(visitedRegions, 100, 1_000_000);
  const countryById = new Map(
    countryFine.features.map((feature) => [String(feature.id), feature]),
  );
  const regionById = new Map(
    regionFine.features.map((feature) => [String(feature.id), feature]),
  );
  const anchored = resolved.map((visit) => {
    const boundary = visit.region
      ? regionById.get(visit.region)
      : countryById.get(visit.country);
    if (!boundary) throw new Error(`Missing boundary anchor for ${visit.id}`);
    const coordinates =
      visit.city || visit.address
        ? visit.coordinates
        : boundary.properties.anchor;
    if (!coordinates)
      throw new Error(`Missing resolved coordinates for ${visit.id}`);
    return { ...visit, coordinates };
  });
  const places = collapseVisits(anchored);
  const files: Record<string, string> = {
    "countries.geojson": JSON.stringify(countryCoarse),
    "countries-fine.geojson": JSON.stringify(countryFine),
    "regions.geojson": JSON.stringify(regionCoarse),
    "regions-fine.geojson": JSON.stringify(regionFine),
    "places.json": JSON.stringify(places),
    "visits.json": JSON.stringify(anchored.map(publicVisit)),
  };
  let geometryBytes = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = gzipSync(text, { level: 9 }).byteLength;
    if (name.endsWith(".geojson")) geometryBytes += bytes;
    console.log(
      `${name}: ${Buffer.byteLength(text).toLocaleString("en-US")} bytes; gzip ${bytes.toLocaleString("en-US")} bytes`,
    );
  }
  console.log(
    `Geometry total gzip: ${geometryBytes.toLocaleString("en-US")} bytes (target 400,000; maximum 1,000,000)`,
  );
  if (geometryBytes > 1_000_000)
    throw new Error(
      "Geometry exceeds 1 MB gzip; reduce the visited boundary LOD detail before publishing",
    );
  if (geometryBytes > 400_000)
    console.warn("Geometry exceeds the 400 KB gzip target");
  const destination = resolve(root, "src/generated");
  await mkdir(destination, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      writeFile(resolve(destination, name), `${text}\n`),
    ),
  );
  await repository.save();
  console.log(
    `Published ${countryFine.features.length} countries, ${regionFine.features.length} regions, ${places.length} places, ${anchored.length} visits`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
