import { describe, it, expect, vi, afterEach } from "vitest";
import fc from "fast-check";
import {
  validateConfig,
  collapseVisits,
  dateBounds,
  buildQuery,
  queryKey,
  resolveVisits,
} from "../scripts/config.ts";
import type { Visit, Cache } from "../scripts/config.ts";
import { expression } from "@maplibre/maplibre-gl-style-spec";
import { bands } from "../src/map/expressions.ts";
import { BoundaryRepository } from "../scripts/boundaries.ts";
import { geocodeConfig } from "../scripts/geocode.ts";
const good: Visit = {
  id: "berlin",
  label: "Berlin",
  country: "DE",
  city: "Berlin",
  coordinates: [13.405, 52.52],
};
it("accepts Natural Earth Kosovo territory identity", () =>
  expect(
    validateConfig({
      visits: [{ id: "kosovo", label: "Kosovo", country: "XK" }],
    }).visits[0].country,
  ).toBe("XK"));
it("uses an address's region to disambiguate city publication", () => {
  const visit: Visit = {
    id: "landmark",
    label: "Landmark",
    country: "DE",
    address: "Public landmark",
  };
  const city = { country: "DE", city: "Berlin" };
  const cache: Cache = {
    [queryKey(buildQuery(visit, "address"))]: {
      kind: "address",
      country: "DE",
      region: "DE-BE",
      city: "Berlin",
      coordinates: [13.3777, 52.5163],
    },
    [queryKey(buildQuery(city, "city"))]: {
      kind: "city",
      country: "DE",
      region: "DE-BY",
      city: "Berlin",
      coordinates: [11.582, 48.135],
    },
    [queryKey(buildQuery({ ...city, region: "DE-BE" }, "city"))]: {
      kind: "city",
      country: "DE",
      region: "DE-BE",
      city: "Berlin",
      coordinates: [13.405, 52.52],
    },
  };
  const resolved = resolveVisits({ visits: [visit] }, cache)[0];
  expect(resolved.coordinates).toEqual([13.405, 52.52]);
  expect(resolved.region).toBeUndefined();
});
describe("generated visit identities", () => {
  it("keeps Unicode places and repeated visits distinct across unrelated reorderings", () => {
    const first = { country: "SE", city: "Ödsmål", date: "2025-06-18" };
    const plain = { ...first, city: "Odsmal" };
    const tokyo = { country: "JP", city: "東京", date: "2025-06-18" };
    const osaka = { ...tokyo, city: "大阪" };
    const later = { ...first, date: "2026-06-18" };
    const original = validateConfig({
      visits: [first, plain, tokyo, first, osaka, later],
    }).visits;
    const reordered = validateConfig({
      visits: [
        { country: "FR", city: "Paris", date: "2026-01-01" },
        later,
        osaka,
        first,
        tokyo,
        plain,
        first,
      ],
    }).visits;
    expect(new Set(original.map((visit) => visit.id)).size).toBe(6);
    expect(reordered.slice(1).map((visit) => visit.id).sort()).toEqual(
      original.map((visit) => visit.id).sort(),
    );
    for (const visit of original) {
      expect(visit.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(visit.label).toBe(visit.city);
    }
  });
  it("does not collide with an explicit identity override", () => {
    const city = { country: "DE", city: "Berlin", date: "2024-04-25" };
    const generated = validateConfig({ visits: [city] }).visits[0].id;
    const config = validateConfig({
      visits: [city, { country: "FR", city: "Paris", id: generated }],
    });
    expect(config.visits[0].id).not.toBe(config.visits[1].id);
    expect(config.visits[1].id).toBe(generated);
  });
});
it("keeps cache administrative provenance out of geographic boundary matching", () => {
  const config = validateConfig({
    visits: [{ country: "GR", city: "Kalamos", date: "2025-04-27" }],
  });
  const visit = config.visits[0];
  const cache: Cache = {
    [queryKey(buildQuery(visit, "city"))]: {
      kind: "city",
      country: "GR",
      region: "GR-A2",
      city: "Kalamos",
      coordinates: [23.86, 38.28],
    },
  };
  const resolved = resolveVisits(config, cache)[0];
  expect(resolved.coordinates).toEqual([23.86, 38.28]);
  expect(resolved.region).toBeUndefined();
});
describe("settlement geocoding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  const village = {
    lat: "53.4342967",
    lon: "9.4633076",
    importance: 0.2,
    name: "Hollenbeck",
    addresstype: "village",
    display_name: "Hollenbeck, Harsefeld, Germany",
    address: {
      country_code: "de",
      village: "Hollenbeck",
      town: "Harsefeld",
      "ISO3166-2-lvl4": "DE-NI",
    },
  };
  function respond(candidates: unknown[]) {
    vi.stubEnv("NOMINATIM_CONTACT", "https://example.com/contact");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(candidates)),
    );
  }
  it("resolves the requested village rather than its containing town", async () => {
    respond([village]);
    const config = validateConfig({
      visits: [{ country: "DE", city: "Hollenbeck", date: "2025-05-24" }],
    });
    const cache = await geocodeConfig(config, {});
    const entry = cache[queryKey(buildQuery(config.visits[0], "city"))];
    expect(entry.city).toBe("Hollenbeck");
    expect(entry.coordinates).toEqual([9.4633076, 53.4342967]);
  });
  it("accepts an upstream short name without country-specific aliases", async () => {
    respond([
      {
        ...village,
        name: "Lübbenau/Spreewald",
        addresstype: "town",
        display_name: "Lübbenau/Spreewald, Germany",
        address: { country_code: "de", town: "Lübbenau/Spreewald" },
        namedetails: { short_name: "Lübbenau" },
      },
    ]);
    const config = validateConfig({
      visits: [{ country: "DE", city: "Lübbenau" }],
    });
    const cache = await geocodeConfig(config, {});
    expect(resolveVisits(config, cache)[0].city).toBe("Lübbenau");
  });
  it("rejects a containing municipality instead of silently moving the visit", async () => {
    respond([{ ...village, name: "Harsefeld", addresstype: "town" }]);
    const config = validateConfig({
      visits: [{ country: "DE", city: "Hollenbeck" }],
    });
    await expect(geocodeConfig(config, {})).rejects.toThrow(
      /no settlement with the requested name/,
    );
  });
  it("rejects distinct same-named settlements even with a large importance gap", async () => {
    respond([
      village,
      {
        ...village,
        importance: 0.9,
        lat: "54",
        lon: "10",
        display_name: "Hollenbeck, Another municipality, Germany",
      },
    ]);
    const config = validateConfig({
      visits: [{ country: "DE", city: "Hollenbeck" }],
    });
    await expect(geocodeConfig(config, {})).rejects.toThrow(
      /multiple settlements match the requested name/,
    );
  });
});
describe("authored config corpus", () => {
  const valid = [
    good,
    { id: "france", label: "France", country: "FR" },
    { ...good, region: "DE-BE" },
    { ...good, date: "2020-02-29" },
    { ...good, dateRange: ["2019-01-01", ""] },
    { ...good, publishPrecision: "exact" },
  ];
  for (const [i, visit] of valid.entries())
    it("valid " + i, () =>
      expect(validateConfig({ visits: [visit] }).visits).toHaveLength(1),
    );
  const broken = [
    [{ ...good, country: undefined }, "country is required"],
    [
      { ...good, country: "ZZ" },
      "country must be an assigned ISO 3166-1 alpha-2 code",
    ],
    [{ ...good, region: "FR-IDF" }, "region FR-IDF does not belong to DE"],
    [{ ...good, date: "2021-02-29" }, "date must be a real ISO date"],
    [
      {
        ...good,
        address: "Unknown impossible address",
        coordinates: undefined,
        city: undefined,
      },
      "geocache miss for berlin; run npm run geocode or add explicit coordinates",
    ],
    [{ ...good, id: "bad id" }, "id must be a stable lowercase slug"],
  ];
  for (const [i, [visit, message]] of broken.entries())
    it("invalid " + i, () =>
      expect(() => validateConfig({ visits: [visit] }, {})).toThrow(
        String(message),
      ),
    );
  it("duplicate ids", () =>
    expect(() => validateConfig({ visits: [good, good] })).toThrow(
      "duplicate id: berlin",
    ));
  it("rejects personal fields", () =>
    expect(() =>
      validateConfig({ visits: [{ ...good, notes: "private" }] }),
    ).toThrow("Unrecognized key"));
  it("rejects removed tag fields", () =>
    expect(() =>
      validateConfig({ visits: [{ ...good, tags: ["city"] }] }),
    ).toThrow("Unrecognized key"));
});
it("upstream region names resolve within their country", async () => {
  const previous = process.env.ATLAS_FIXTURE;
  process.env.ATLAS_FIXTURE = "1";
  try {
    const config = validateConfig({
      visits: [
        {
          id: "berlin-region",
          label: "Berlin",
          country: "DE",
          region: "Berlin",
        },
      ],
    });
    const repository = await BoundaryRepository.open();
    const found = await repository.regions("DE", "DEU", config.visits);
    expect(found.boundaries.map((feature) => feature.id)).toEqual(["DE-BE"]);
    await expect(
      repository.regions("DE", "DEU", [{ region: "Île-de-France" }]),
    ).rejects.toThrow(
      "ATLAS_FIXTURE=1: missing committed boundary coverage for data/.geocache/gbOpen-DEU-ADM1.geojson; network and mutable download caches are disabled",
    );
  } finally {
    if (previous === undefined) delete process.env.ATLAS_FIXTURE;
    else process.env.ATLAS_FIXTURE = previous;
  }
});
describe("date and collapse properties", () => {
  it("collapse conserves visits and deduplicates cities", () =>
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5 }), {
          minLength: 1,
          maxLength: 60,
        }),
        (xs) => {
          const pins = collapseVisits(
            xs.map((n, i) => ({
              ...good,
              id: "v-" + i,
              city: "city-" + n,
              date: "2020-01-01",
            })),
          );
          expect(pins.reduce((sum, p) => sum + p.visitCount, 0)).toBe(
            xs.length,
          );
          expect(pins.length).toBe(new Set(xs).size);
        },
      ),
      { seed: 20260915 },
    ));
  it("ranges contain their endpoints and are ordered", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2099 }),
        fc.integer({ min: 1900, max: 2099 }),
        (a, b) => {
          const start = Math.min(a, b) + "-01-01",
            end = Math.max(a, b) + "-12-31";
          expect(dateBounds({ dateRange: [start, end] })).toEqual([start, end]);
        },
      ),
      { seed: 20260915 },
    ));
  it("open intervals remain open", () =>
    expect(dateBounds({ dateRange: ["2020-01-01", ""] })).toEqual([
      "2020-01-01",
      "9999-12-31",
    ]));
});
it("actual MapLibre zoom expressions have continuous overlapping bands", () => {
  const samples = Object.values(bands).map((value) => {
    const parsed = expression.createExpression(value, {
      type: "number",
      default: 1,
      transition: true,
      "property-type": "data-driven",
      expression: {
        interpolated: true,
        parameters: ["zoom", "feature", "feature-state"],
      },
    });
    if (parsed.result === "error")
      throw new Error(JSON.stringify(parsed.value));
    return Array.from({ length: 65 }, (_, i) =>
      Number(parsed.value.evaluate({ zoom: i / 4 })),
    );
  });
  for (let i = 0; i < 65; i++) {
    expect(
      Math.max(...samples.map((v) => v[i])),
      "opacity gap at z" + i / 4,
    ).toBeGreaterThan(0.05);
    for (const v of samples)
      if (i)
        expect(
          Math.abs(v[i] - v[i - 1]),
          "opacity discontinuity z" + i / 4,
        ).toBeLessThanOrEqual(0.26);
  }
  for (const v of samples) {
    const peak = v.indexOf(Math.max(...v));
    for (let i = 1; i <= peak; i++)
      expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
    for (let i = peak + 1; i < v.length; i++)
      expect(v[i]).toBeLessThanOrEqual(v[i - 1]);
  }
  for (let band = 0; band < 2; band++)
    expect(
      samples[band].filter((v, i) => v > 0.05 && samples[band + 1][i] > 0.05)
        .length * 0.25,
    ).toBeGreaterThanOrEqual(0.5);
});
describe("text folding and captions", () => {
  it("matches diacritics-free input against accented place names", async () => {
    const { fold, slug } = await import("../src/map/text.ts");
    for (const [typed, actual] of [
      ["odsmal", "Ödsmål"],
      ["hoor", "Höör"],
      ["lubbenau", "Lübbenau"],
      ["swinemunde", "Swinemünde"],
    ])
      expect(fold(actual)).toContain(fold(typed));
    expect(fold("Ödsmål")).toBe(fold("ödsmål"));
    expect(slug("Wendisch  Rietz")).toBe("wendisch-rietz");
    fc.assert(
      fc.property(fc.string(), (value) => fold(fold(value)) === fold(value)),
    );
  });
  it("omits a region whose label merely repeats the place", async () => {
    const { captionGeography } = await import("../src/map/caption.ts");
    const labels = { "DE-BE": "Berlin", "GR-AT": "Attica" };
    expect(
      captionGeography({ label: "Berlin", region: "DE-BE" }, labels, "Germany"),
    ).toEqual({ country: "Germany" });
    expect(
      captionGeography({ label: "Kalamos", region: "GR-AT" }, labels, "Greece"),
    ).toEqual({ region: "Attica", country: "Greece" });
    expect(captionGeography({ label: "Kalamos" }, labels, "Greece")).toEqual({
      country: "Greece",
    });
  });
});
describe("label anchors and pointer bands", () => {
  it("selects the band's pointer target at the documented thresholds", async () => {
    const { activeLayer } = await import("../src/map/layers.ts");
    expect(activeLayer(1.8)).toBe("countries");
    expect(activeLayer(3.49)).toBe("countries");
    expect(activeLayer(3.5)).toBe("regions");
    expect(activeLayer(6.49)).toBe("regions");
    expect(activeLayer(6.5)).toBe("pins");
  });
  it("label bands extinguish under feature-state and hand over between zooms", async () => {
    const { withVisibility } = await import("../src/map/expressions.ts");
    for (const key of ["countryLabel", "regionLabel"] as const) {
      const parsed = expression.createExpression(withVisibility(bands[key]));
      expect(parsed.result).toBe("success");
      if (parsed.result !== "success") return;
      const at = (zoom: number, visibility: number) =>
        Number(parsed.value.evaluate({ zoom }, undefined, { visibility }));
      expect(at(3.5, 0)).toBe(0);
      expect(at(5.5, 0)).toBe(0);
      expect(at(key === "countryLabel" ? 3.5 : 5.5, 1)).toBe(1);
    }
    const country = expression.createExpression(bands.countryLabel);
    const region = expression.createExpression(bands.regionLabel);
    if (country.result !== "success" || region.result !== "success") throw new Error();
    // Country names fade out as region names arrive; neither is fully lit at the same zoom.
    for (let zoom = 0; zoom <= 16; zoom += 0.25) {
      const c = Number(country.value.evaluate({ zoom }));
      const r = Number(region.value.evaluate({ zoom }));
      expect(c + r).toBeLessThanOrEqual(1.5);
    }
  });
});
describe("time predicate and hash routes", () => {
  it("lights visits cumulatively by first date and by month when only", async () => {
    const { visibleAt, nights, dateBounds } = await import("../src/map/time.ts");
    const trip = { dateRange: ["2025-06-24", "2025-07-01"] as [string, string] };
    expect(visibleAt(trip, null)).toBe(1);
    expect(visibleAt(trip, "2025-06-23")).toBe(0);
    expect(visibleAt(trip, "2025-06-24")).toBe(1);
    expect(visibleAt(trip, "2026-01-01")).toBe(1);
    expect(visibleAt(trip, "2025-06-01", "only")).toBe(1);
    expect(visibleAt(trip, "2025-07-15", "only")).toBe(1);
    expect(visibleAt(trip, "2025-08-01", "only")).toBe(0);
    expect(visibleAt({}, "2019-01-01")).toBe(1);
    expect(visibleAt({ dateRange: ["", "2020-01-01"] }, "2019-01-01")).toBe(1);
    expect(nights(trip)).toBe(7);
    expect(nights({ date: "2024-04-25" })).toBeUndefined();
    expect(nights({ dateRange: ["2020-01-01", ""] })).toBeUndefined();
    const day = fc
      .integer({ min: 0, max: 20000 })
      .map((n) => new Date(n * 86_400_000).toISOString().slice(0, 10));
    fc.assert(
      fc.property(day, day, day, (a, b, c) => {
        const [start, end] = [a, b].sort();
        const visit = { dateRange: [start, end] as [string, string] };
        const [s, e] = dateBounds(visit);
        // Cumulative visibility is monotonic in the scrubber position.
        return (
          s === start && e === end &&
          (c < start ? visibleAt(visit, c) === 0 : visibleAt(visit, c) === 1)
        );
      }),
    );
  });
  it("round-trips place, view and filter routes and rejects malformed ones", async () => {
    const { parseHash, formatHash } = await import("../src/map/router.ts");
    expect(parseHash("")).toEqual({});
    expect(parseHash("#/place/de-berlin-1a2b3c4d")).toEqual({ place: "de-berlin-1a2b3c4d" });
    expect(parseHash("#/view/5.00/51.2000/10.4000?through=2025-06-24&mode=only")).toEqual({
      view: { zoom: 5, lat: 51.2, lng: 10.4 },
      through: "2025-06-24",
      mode: "only",
    });
    expect(parseHash("#/view/99/200/10")).toEqual({});
    expect(parseHash("#?through=yesterday&mode=maybe")).toEqual({});
    expect(formatHash({})).toBe("");
    expect(formatHash({ through: "2025-06-24" })).toBe("#?through=2025-06-24");
    expect(parseHash("#/place/%E2%82%AC")).toEqual({ place: "€" });
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 24, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.boolean(),
        (zoom, lat, lng, only) => {
          const hash = formatHash({
            view: { zoom, lat, lng },
            through: "2024-01-01",
            ...(only ? { mode: "only" as const } : {}),
          });
          return formatHash(parseHash(hash)) === hash;
        },
      ),
    );
  });
});
