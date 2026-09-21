import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BoundaryRepository,
  containsPoint,
  type RawFeature,
} from "../scripts/boundaries.ts";

const temporary: string[] = [];

beforeEach(() => {
  vi.stubEnv("ATLAS_FIXTURE", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function rectangle(
  properties: Record<string, unknown>,
  west = 0,
  east = 2,
): RawFeature {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [[[west, 0], [east, 0], [east, 2], [west, 2], [west, 0]]],
    },
  };
}

function gb(iso = "GR-AT", shapeID = "attica"): RawFeature {
  return rectangle({
    shapeISO: iso,
    shapeID,
    shapeName: "Attica",
    shapeGroup: "GRC",
    shapeType: "ADM1",
  });
}

async function repository(
  preferred: RawFeature[] | string | undefined,
  fallback = [rectangle({ iso_a2: "GR", iso_3166_2: "GR-A1", name_en: "Attica" })],
  country = "GRC",
) {
  const directory = await mkdtemp(join(tmpdir(), "atlas-boundaries-"));
  temporary.push(directory);
  async function source(name: string, data: RawFeature[] | string) {
    const bytes = typeof data === "string"
      ? data
      : JSON.stringify({ type: "FeatureCollection", features: data });
    const cache = join(directory, `${name}.geojson`);
    await writeFile(cache, bytes);
    return {
      provider: name,
      version: "pinned",
      url: `https://example.invalid/${name}.geojson`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      cache,
      license: "Public domain",
      licenseURL: "https://example.invalid/license",
    };
  }
  const naturalEarthRegions = await source("natural-earth", fallback);
  const manifest = {
    version: 1,
    naturalEarthCountries: naturalEarthRegions,
    naturalEarthRegions,
    geoBoundaries: preferred === undefined ? {} : { [country]: await source("gbOpen", preferred) },
    fallbacks: [],
  };
  const path = join(directory, "sources.json");
  await writeFile(path, JSON.stringify(manifest));
  return { instance: await BoundaryRepository.open(path), path, manifest };
}

it("selects preferred geographic coverage instead of a different provider's code", async () => {
  const { instance } = await repository([gb()]);
  const result = await instance.regions("GR", "GRC", [{ coordinates: [1, 1] }]);
  expect(result.assignments).toEqual(["GR-AT"]);
  expect(result.boundaries.map((feature) => feature.id)).toEqual(["GR-AT"]);
});

it("keeps usable regions without ISO codes and preserves IDs across feature ordering", async () => {
  const first = gb("", "native-a");
  const second = rectangle({ ...gb("not-an-iso-code", "native-b").properties }, 3, 5);
  const forward = await repository([first, second]);
  const reverse = await repository([second, first]);
  const requests: { coordinates: [number, number] }[] = [
    { coordinates: [1, 1] },
    { coordinates: [4, 1] },
  ];
  const a = await forward.instance.regions("GR", "GRC", requests);
  const b = await reverse.instance.regions("GR", "GRC", requests);
  expect(a.assignments).toEqual(["GR-gb-native-a", "GR-gb-native-b"]);
  expect(b.assignments).toEqual(a.assignments);
  const withoutId = { ...first, properties: { ...first.properties, shapeID: undefined } };
  const noId = await repository([withoutId]);
  const discovered = await noId.instance.regions("GR", "GRC", requests.slice(0, 1));
  expect(discovered.assignments[0]).toMatch(/^GR-gb-[a-f0-9]{64}$/);
  expect(discovered.boundaries[0].properties.label).toBe("Attica");
});

it("honors explicit names and codes without substituting a containing unrelated region", async () => {
  const { instance } = await repository([gb()]);
  expect((await instance.regions("GR", "GRC", [{ region: "Attica", coordinates: [1, 1] }])).assignments)
    .toEqual(["GR-AT"]);
  await expect(instance.regions("GR", "GRC", [{ region: "GR-A2", coordinates: [1, 1] }]))
    .rejects.toThrow("explicit region constraints are not replaced");
  await expect(instance.regions("GR", "GRC", [{ region: "GR-AT", coordinates: [4, 1] }]))
    .rejects.toThrow("explicit region constraints are not replaced");
});

it("uses actual fallback coverage for a coastal gap, without nearest-region guessing", async () => {
  const { instance, path } = await repository(
    [gb()],
    [rectangle({ iso_a2: "GR", iso_3166_2: "GR-A1", name_en: "Attica" }, 0, 3)],
  );
  const result = await instance.regions("GR", "GRC", [
    { coordinates: [2.1, 1] },
    { coordinates: [3.001, 1] },
  ]);
  expect(result.assignments).toEqual(["GR-A1", undefined]);
  expect(result.boundaries.map((feature) => feature.id)).toEqual(["GR-A1"]);
  await instance.save();
  const pinned = JSON.parse(await readFile(path, "utf8"));
  expect(pinned.fallbacks).toEqual([expect.objectContaining({ country: "GR", region: "GR-A1" })]);
});

it("does not count a polygon hole as regional coverage", async () => {
  const shape = gb();
  if (shape.geometry.type !== "Polygon") throw new Error("Expected polygon");
  shape.geometry.coordinates.push([[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]);
  expect(containsPoint(shape.geometry, [1, 1])).toBe(false);
  expect(containsPoint(shape.geometry, [0.25, 1])).toBe(true);
});

it("pins confirmed absent ADM1 coverage and ignores whole-country Natural Earth placeholders", async () => {
  const download = vi.fn().mockResolvedValue(new Response("Not found", { status: 404 }));
  vi.stubGlobal("fetch", download);
  const { instance, path } = await repository(undefined, [rectangle({
    iso_a2: "VA",
    iso_3166_2: "VA-X01~",
    adm1_code: "VAT+00?",
    gadm_level: 0,
    name_en: "Vatican City",
  })], "VAT");
  const requests: { coordinates: [number, number] }[] = [{ coordinates: [1, 1] }];
  const result = await instance.regions("VA", "VAT", requests);
  expect(result).toEqual({ assignments: [undefined], boundaries: [] });
  await instance.save();
  download.mockRejectedValue(new Error("Network unavailable after pinning"));
  const reopened = await BoundaryRepository.open(path);
  expect(await reopened.regions("VA", "VAT", requests)).toEqual(result);
  await expect(reopened.regions("VA", "VAT", [{ region: "Vatican City" }]))
    .rejects.toThrow("explicit region constraints are not replaced");
});

it("propagates service failures instead of treating them as absent coverage", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
  const { instance } = await repository(undefined);
  await expect(instance.regions("GR", "GRC", [{ coordinates: [1, 1] }]))
    .rejects.toThrow("Boundary discovery 503");
});

it("rejects corrupt or wrong-level preferred data rather than hiding it with fallback", async () => {
  const malformed = await repository('{"type":"FeatureCollection","features":[{}]}');
  await expect(malformed.instance.regions("GR", "GRC", [{ coordinates: [1, 1] }]))
    .rejects.toThrow("unusable polygon feature");
  const wrongLevel = gb();
  wrongLevel.properties.shapeType = "ADM2";
  const level = await repository([wrongLevel]);
  await expect(level.instance.regions("GR", "GRC", [{ coordinates: [1, 1] }]))
    .rejects.toThrow("expected country-scoped ADM1 features");
  const corrupt = await repository([gb()]);
  await writeFile(corrupt.manifest.geoBoundaries.GRC!.cache, "tampered");
  await expect(corrupt.instance.regions("GR", "GRC", [{ coordinates: [1, 1] }]))
    .rejects.toThrow("SHA256 mismatch");
});
