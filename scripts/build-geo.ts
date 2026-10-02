import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import mapshaper from "mapshaper";
import authoredConfig from "../data/visits.ts";
import fixtureConfig from "../verification/fixtures/visits.ts";
import {
  cacheSchema,
  collapseVisits,
  homeVisits,
  publicVisit,
  resolveHomes,
  resolveVisits,
  validateConfig,
} from "./config.ts";
import { assignDayTrips, groupTrips, routeFeatures, type TripVisit } from "./trips.ts";
import { computeStats } from "./stats.ts";
import { placeKey } from "../src/map/place-key.ts";
import {
  BoundaryRepository,
  boundaryWeights,
  geometryMetadata,
  root,
  type Boundary,
  type Boundaries,
  type RawCollection,
} from "./boundaries.ts";

/**
 * Simplification intervals in metres, chosen from the zoom at which each level
 * of detail is drawn so that no interval exceeds a screen pixel while its layer
 * is more than faint. At 52° latitude a pixel spans about 4.3 km at zoom 4.5,
 * 1.7 km at 5.75, 1.2 km at 6.3 and 47 m at 11.
 *
 * - Coarse countries carry the world view up to zoom 4.5.
 * - Fine countries take over at zoom 4.5, where the country fill has already
 *   faded to 2 % and its outline to 6 %; 1 km stays under a pixel to zoom 6.3,
 *   beyond which the layer sits at 1 % and is context, not subject.
 * - Coarse regions carry zooms below 3, where the region band is still dark.
 * - Fine regions are the regions from zoom 3 on: 200 m is well under a pixel
 *   through the band's full strength (to zoom 5.75) and draws a smooth enough
 *   8 % context line at the place view.
 *
 * Coordinates are written to four decimals (11 m), a twentieth of the finest
 * interval; the fifth decimal was a metre of precision on 100 m geometry.
 */
const detail = {
  countryCoarse: { interval: 2000, quantization: 100_000 },
  countryFine: { interval: 1000, quantization: 1_000_000 },
  regionCoarse: { interval: 750, quantization: 100_000 },
  regionFine: { interval: 200, quantization: 1_000_000 },
  precision: 0.0001,
} as const;

async function simplify(
  features: Boundary[],
  { interval, quantization }: { interval: number; quantization: number },
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
    `-i output.topojson -o output.geojson format=geojson precision=${detail.precision}`,
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
  // A home is a place lived in: it lights its region and counts among the
  // places, so it travels through the pipeline as a city-precision visit.
  const resolved = [
    ...resolveVisits(authored, cache),
    ...resolveVisits({ visits: homeVisits(authored), publishPrecision: "city" }, cache),
  ];
  const repository = await BoundaryRepository.open();
  const countryCodes = [
    ...new Set(resolved.map((visit) => visit.country)),
  ].sort();
  const countries = await repository.countries(countryCodes);
  const regions: Boundary[] = [];
  const regionsOf: Record<string, number> = {};
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
    if (discovered.total) regionsOf[country] = discovered.total;
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
  const countryCoarse = await simplify(countries.boundaries, detail.countryCoarse);
  const countryFine = await simplify(countries.boundaries, detail.countryFine);
  const regionCoarse = await simplify(visitedRegions, detail.regionCoarse);
  const regionFine = await simplify(visitedRegions, detail.regionFine);
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
  const placeByKey = new Map(places.map((place) => [placeKey(place), place]));
  const homes = resolveHomes(authored, cache);
  // Day trips resolve to the stay (or home) they were made from before
  // journeys form, so they ride with their base instead of chaining as stops.
  const tripVisits: TripVisit[] = assignDayTrips(
    anchored.flatMap((visit) => {
      if (!visit.city && !visit.address) return [];
      const place = placeByKey.get(placeKey(visit));
      if (!place) return [];
      return [
        {
          id: visit.id,
          placeId: place.id,
          country: visit.country,
          coordinates: visit.coordinates,
          ...(visit.trip ? { trip: visit.trip } : {}),
          ...(visit.dayTrip ? { dayTrip: true } : {}),
          ...(visit.date !== undefined ? { date: visit.date } : {}),
          ...(visit.dateRange !== undefined ? { dateRange: visit.dateRange } : {}),
        },
      ];
    }),
    homes,
  );
  const baseOf = new Map(tripVisits.flatMap((visit) => (visit.from ? [[visit.id, visit.from]] : [])));
  const published = anchored.map((visit) =>
    publicVisit({ ...visit, ...(baseOf.has(visit.id) ? { from: baseOf.get(visit.id) } : {}) }),
  );
  for (const place of places) {
    const dayTrips = tripVisits.filter(
      (visit) => visit.from && visit.placeId === place.id,
    ).length;
    if (dayTrips) place.dayTrips = dayTrips;
  }
  const grouped = groupTrips(tripVisits);
  const inJourney = new Set(grouped.flatMap((entry) => entry.visits.map((visit) => visit.id)));
  const { trips, routes } = routeFeatures(
    grouped,
    tripVisits.filter((visit) => !inJourney.has(visit.id)),
    new Map(places.map((place) => [place.id, place.coordinates])),
    homes,
  );
  // Label anchors: one interior point per published boundary, keyed like its polygon.
  // Deliberately without a country field so the payload audit does not read them as places.
  const anchors = {
    type: "FeatureCollection",
    features: [
      ...countryFine.features.map((feature) => ({
        type: "Feature",
        id: String(feature.id),
        properties: {
          id: String(feature.id),
          kind: "country",
          label: feature.properties.label,
        },
        geometry: { type: "Point", coordinates: feature.properties.anchor },
      })),
      ...regionFine.features.map((feature) => ({
        type: "Feature",
        id: String(feature.id),
        properties: {
          id: String(feature.id),
          kind: "region",
          label: feature.properties.label,
        },
        geometry: { type: "Point", coordinates: feature.properties.anchor },
      })),
    ],
  };
  const files: Record<string, string> = {
    "anchors.json": JSON.stringify(anchors),
    "countries.geojson": JSON.stringify(countryCoarse),
    "countries-fine.geojson": JSON.stringify(countryFine),
    "regions.geojson": JSON.stringify(regionCoarse),
    "regions-fine.geojson": JSON.stringify(regionFine),
    "places.json": JSON.stringify(places),
    "home.json": JSON.stringify(homes),
    "trips.json": JSON.stringify(trips),
    "stats.json": JSON.stringify(
      computeStats(published, places, {
        trips,
        homes,
        legs: routes.features.map((feature) => {
          const line = feature.geometry.coordinates;
          return [line[0], line[line.length - 1]] as [[number, number], [number, number]];
        }),
        regionsOf,
      }),
    ),
    "routes.json": JSON.stringify(routes),
    "visits.json": JSON.stringify(published),
  };
  let geometryBytes = 0;
  let inlineBytes = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = gzipSync(text, { level: 9 }).byteLength;
    if (name.endsWith(".geojson")) geometryBytes += bytes;
    if (name === "countries.geojson" || name === "regions.geojson")
      inlineBytes += bytes;
    console.log(
      `${name}: ${Buffer.byteLength(text).toLocaleString("en-US")} bytes; gzip ${bytes.toLocaleString("en-US")} bytes`,
    );
  }
  // Per boundary, so the heaviest coastline is named when the budget is near.
  for (const [name, collection] of [
    ["countries-fine", countryFine],
    ["regions-fine", regionFine],
  ] as const)
    console.log(
      `${name} by boundary (gzip KB): ${boundaryWeights(collection)
        .map(({ id, bytes }) => `${id} ${Math.round(bytes / 1024)}`)
        .join(", ")}`,
    );
  console.log(
    `Geometry inline gzip: ${inlineBytes.toLocaleString("en-US")} bytes (coarse LODs in style.json; target 120,000); total gzip ${geometryBytes.toLocaleString("en-US")} bytes (target 400,000; maximum 1,000,000)`,
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
  const dayTrips = tripVisits.filter((visit) => visit.from).length;
  console.log(
    `Published ${countryFine.features.length} countries, ${regionFine.features.length} regions, ${places.length} places, ${anchored.length} visits (${dayTrips} day ${dayTrips === 1 ? "trip" : "trips"}), ${trips.length} journeys, ${homes.length} ${homes.length === 1 ? "home" : "homes"}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
