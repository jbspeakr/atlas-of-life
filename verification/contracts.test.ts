import { describe, it, expect, vi, afterEach } from "vitest";
import ts from "typescript";
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
import { mergeThemes } from "../scripts/themes.ts";
import { globeRadius, starOpacity, starTile, starfield } from "../src/map/sky.ts";
import type { ExpressionSpecification } from "maplibre-gl";
import { BoundaryRepository } from "../scripts/boundaries.ts";
import { geocodeConfig } from "../scripts/geocode.ts";
import { payloadViolations } from "./payload.ts";
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
  it("accepts an alternative name from a boundary's linked place node", async () => {
    respond([
      {
        ...village,
        name: "Ahlbeck",
        display_name: "Ahlbeck, Heringsdorf, Germany",
        address: { country_code: "de", village: "Ahlbeck" },
        namedetails: {
          name: "Ahlbeck",
          alt_name: "Seeheilbad Ahlbeck",
          _place_alt_name: "Seebad Ahlbeck;Ostseeheilbad Ahlbeck",
        },
      },
    ]);
    const config = validateConfig({
      visits: [{ country: "DE", city: "Seebad Ahlbeck" }],
    });
    const cache = await geocodeConfig(config, {});
    expect(resolveVisits(config, cache)[0].city).toBe("Seebad Ahlbeck");
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
    const parsed = expression.createExpression(value, "band", {
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
      const parsed = expression.createExpression(withVisibility(bands[key]), key);
      expect(parsed.result).toBe("success");
      if (parsed.result !== "success") return;
      const at = (zoom: number, visibility: number) =>
        Number(parsed.value.evaluate({ zoom }, undefined, { visibility }));
      expect(at(3.5, 0)).toBe(0);
      expect(at(5.5, 0)).toBe(0);
      expect(at(key === "countryLabel" ? 3.5 : 5.5, 1)).toBe(1);
    }
    const country = expression.createExpression(bands.countryLabel, "countryLabel");
    const region = expression.createExpression(bands.regionLabel, "regionLabel");
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
describe("journeys", () => {
  const visit = (
    id: string,
    country: string,
    start: string,
    end: string,
    extra: Partial<import("../scripts/trips.ts").TripVisit> = {},
  ): import("../scripts/trips.ts").TripVisit => ({
    id,
    placeId: `place-${id}`,
    country,
    coordinates: [10, 50],
    ...(start === end ? { date: start } : { dateRange: [start, end] as [string, string] }),
    ...extra,
  });
  it("chains contiguous and overlapping visits, splits on a two-day gap, excludes singles", async () => {
    const { inferTrips } = await import("../scripts/trips.ts");
    const trips = inferTrips([
      visit("a", "DE", "2025-05-24", "2025-05-25"),
      visit("b", "DK", "2025-05-25", "2025-06-01"),
      visit("c", "DK", "2025-06-02", "2025-06-03"), // one-day gap joins
      visit("d", "NO", "2025-06-06", "2025-06-07"), // three-day gap splits
      visit("e", "SE", "2025-06-07", "2025-06-07"),
      visit("f", "FR", "2026-05-14", "2026-05-18"), // alone
      visit("g", "GB", "2020-01-01", ""), // open range never joins
      { id: "h", placeId: "place-h", country: "IT", coordinates: [12, 41] },
    ]);
    expect(trips.map((trip) => trip.stops)).toEqual([
      ["place-a", "place-b", "place-c"],
      ["place-d", "place-e"],
    ]);
    expect(trips[0]).toMatchObject({ start: "2025-05-24", end: "2025-06-03", label: "Germany and Denmark, 2025" });
    expect(trips[1].label).toBe("Norway and Sweden, 2025");
    expect(trips[0].id).toMatch(/^trip-germany-and-denmark-2025-[a-f0-9]{8}$/);
  });
  it("groups authored trip labels across gaps and prefers the authored label", async () => {
    const { inferTrips } = await import("../scripts/trips.ts");
    const trips = inferTrips([
      visit("a", "DE", "2025-01-01", "2025-01-02", { trip: "Winter" }),
      visit("b", "AT", "2025-03-01", "2025-03-02", { trip: "Winter" }),
      visit("c", "CH", "2025-03-02", "2025-03-03"),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ label: "Winter", stops: ["place-a", "place-b"] });
  });
  it("collapses consecutive stops at the same place and spans years in the label", async () => {
    const { inferTrips } = await import("../scripts/trips.ts");
    const trips = inferTrips([
      { ...visit("a", "DE", "2025-12-30", "2025-12-31"), placeId: "berlin" },
      { ...visit("b", "DE", "2025-12-31", "2026-01-01"), placeId: "berlin" },
      visit("c", "PL", "2026-01-01", "2026-01-03"),
    ]);
    expect(trips[0].stops).toEqual(["berlin", "place-c"]);
    expect(trips[0].label).toBe("Germany and Poland, 2025–2026");
  });
  it("densifies great circles every 100 km, keeps endpoints exact and unwraps the dateline", async () => {
    const { densify } = await import("../scripts/trips.ts");
    const line = densify([[13.405, 52.52], [23.86, 38.28]]);
    expect(line[0]).toEqual([13.405, 52.52]);
    expect(line[line.length - 1]).toEqual([23.86, 38.28]);
    expect(line.length).toBeGreaterThan(15);
    const crossing = densify([[179, 0], [-179, 0]]);
    for (let i = 1; i < crossing.length; i++)
      expect(Math.abs(crossing[i][0] - crossing[i - 1][0])).toBeLessThan(180);
    fc.assert(
      fc.property(
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        (x1, y1, x2, y2) => {
          const out = densify([[x1, y1], [x2, y2]]);
          return out.every(([, lat]) => Math.abs(lat) <= 90.0001) &&
            out.slice(1).every((p, i) => Math.abs(p[0] - out[i][0]) < 180);
        },
      ),
    );
  });
  it("accepts and publishes only the journey fields", async () => {
    const config = validateConfig({
      visits: [{ country: "DE", city: "Berlin", date: "2024-04-25", trip: "Spring" }],
    });
    expect(config.visits[0].trip).toBe("Spring");
    const { payloadViolations } = await import("../verification/payload.ts");
    expect(
      payloadViolations("trips.json", JSON.stringify([
        { id: "trip-x", label: "X", start: "2025-01-01", end: "2025-01-02", stops: ["a"] },
      ])),
    ).toEqual([]);
    expect(
      payloadViolations("trips.json", JSON.stringify([
        { id: "trip-x", label: "X", start: "2025-01-01", end: "2025-01-02", stops: ["a"], notes: "private" },
      ])),
    ).toHaveLength(1);
  });
});
describe("home base", () => {
  const berlinCity = { country: "DE", city: "Berlin" };
  const cache: Cache = {
    [queryKey(buildQuery(berlinCity, "city"))]: {
      kind: "city",
      country: "DE",
      city: "Berlin",
      coordinates: [13.405, 52.52],
    },
  };
  it("accepts one home or several, orders them and ends each where the next begins", () => {
    const single = validateConfig({ home: { ...berlinCity, since: "2024-04-25" }, visits: [] });
    expect(single.homes).toHaveLength(1);
    expect(single.homes[0]).toMatchObject({ label: "Berlin", since: "2024-04-25" });
    expect(single.homes[0].id).toMatch(/^home-berlin-[a-f0-9]{8}$/);
    expect(single.homes[0].until).toBeUndefined();
    const moved = validateConfig({
      home: [
        { country: "DE", city: "Hamburg", since: "2027-03-01" },
        { ...berlinCity, since: "2024-04-25" },
      ],
      visits: [],
    });
    expect(moved.homes.map((home) => [home.city, home.until])).toEqual([
      ["Berlin", "2027-02-28"],
      ["Hamburg", undefined],
    ]);
    expect(validateConfig({ visits: [] }).homes).toEqual([]);
    expect(() =>
      validateConfig({ home: [{ ...berlinCity }, { country: "DE", city: "Hamburg" }], visits: [] }),
    ).toThrow(/distinct since/);
    expect(() =>
      validateConfig({ home: { ...berlinCity, address: "Somewhere 1" }, visits: [] }),
    ).toThrow();
  });
  it("resolves a home at city precision through the warm cache only", async () => {
    const { resolveHomes } = await import("../scripts/config.ts");
    const config = validateConfig({ home: { ...berlinCity, since: "2024-04-25" }, visits: [] });
    expect(resolveHomes(config, cache)).toEqual([
      {
        id: config.homes[0].id,
        label: "Berlin",
        country: "DE",
        city: "Berlin",
        coordinates: [13.405, 52.52],
        since: "2024-04-25",
      },
    ]);
    expect(() => resolveHomes(config, {})).toThrow(/geocache miss/);
  });
  it("counts a home as a place, region and country but never as a trip", async () => {
    const { homeVisits, publicVisit, resolveHomes } = await import("../scripts/config.ts");
    const { computeStats } = await import("../scripts/stats.ts");
    const config = validateConfig({ home: { ...berlinCity, since: "2024-04-25" }, visits: [] });
    expect(homeVisits(config)).toEqual([
      { id: config.homes[0].id, label: "Berlin", country: "DE", city: "Berlin", dateRange: ["2024-04-25", ""] },
    ]);
    expect(homeVisits(validateConfig({ home: berlinCity, visits: [] }))[0].dateRange).toBeUndefined();
    expect(homeVisits(validateConfig({ visits: [] }))).toEqual([]);
    const anchored = resolveVisits({ visits: homeVisits(config), publishPrecision: "city" }, cache) as (Visit & {
      coordinates: [number, number];
    })[];
    const places = collapseVisits(anchored);
    // The place shares the home's ID, so the ring and the place are one selection.
    expect(places).toEqual([
      expect.objectContaining({ id: config.homes[0].id, city: "Berlin", visitCount: 1, dateRange: ["2024-04-25", ""] }),
    ]);
    const visits = anchored.map(publicVisit);
    const stats = computeStats(visits, places, { homes: resolveHomes(config, cache) });
    expect(stats).toMatchObject({ countries: 1, places: 1, visits: 0, nights: 0, firstYear: null, years: [], milestones: [] });
    expect(stats.coverage.states).toBe(1);
    expect(stats.byCountry).toEqual([{ country: "DE", places: 1, regions: 0, regionsOf: null, firstYear: 2024 }]);
    // Without the home list the same record would read as an ordinary visit.
    expect(computeStats(visits, places).visits).toBe(1);
  });
  it("publishes only the home fields", async () => {
    const { payloadViolations } = await import("../verification/payload.ts");
    const home = { id: "home-x", label: "Berlin", country: "DE", city: "Berlin", coordinates: [13.4, 52.5], since: "2024-04-25" };
    expect(payloadViolations("home.json", JSON.stringify([home]))).toEqual([]);
    expect(payloadViolations("home.json", JSON.stringify([{ ...home, address: "Street 1" }]))).toHaveLength(1);
    expect(payloadViolations("home.json", JSON.stringify([home]), { "home-x": [13.5, 52.5] })).toHaveLength(1);
    expect(
      payloadViolations("trips.json", JSON.stringify([
        { id: "trip-x", label: "X", start: "2025-01-01", end: "2025-01-02", stops: ["a", "b"], from: "home-x", to: "home-x" },
      ])),
    ).toEqual([]);
  });
});
describe("journey arcs and home legs", () => {
  const berlin: [number, number] = [13.4, 52.5];
  const home = { id: "home-berlin", coordinates: berlin, since: "2024-04-25" };
  const stop = (
    id: string,
    placeId: string,
    coordinates: [number, number],
    start: string,
    end: string,
  ): import("../scripts/trips.ts").TripVisit => ({
    id,
    placeId,
    country: "DE",
    coordinates,
    ...(start === end ? { date: start } : { dateRange: [start, end] as [string, string] }),
  });
  it("bows symmetrically to the requested side and keeps both ends exact", async () => {
    const { arc } = await import("../scripts/trips.ts");
    const right = arc([0, 0], [10, 0], 1);
    const left = arc([0, 0], [10, 0], -1);
    expect(right[0]).toEqual([0, 0]);
    expect(right[right.length - 1]).toEqual([10, 0]);
    const middle = Math.floor(right.length / 2);
    // Travelling east, right is south; the bow peaks near 14 % of ~1,112 km.
    expect(right[middle][1]).toBeLessThan(-1.2);
    expect(left[middle][1]).toBeGreaterThan(1.2);
    expect(right[middle][1]).toBeCloseTo(-left[middle][1], 5);
    expect(Math.abs(right[1][1])).toBeCloseTo(Math.abs(right[right.length - 2][1]), 2);
    // Even a five-kilometre hop is drawn as a curve, not a two-point segment.
    expect(arc([14.1, 53.94], [14.25, 53.91], 1).length).toBeGreaterThan(20);
    const crossing = arc([179, 10], [-179, 12], 1);
    for (let i = 1; i < crossing.length; i++)
      expect(Math.abs(crossing[i][0] - crossing[i - 1][0])).toBeLessThan(1);
  });
  it("bows loops outward whichever way they are travelled", async () => {
    const { outwardSide } = await import("../scripts/trips.ts");
    const counterClockwise: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(outwardSide(counterClockwise)).toBe(1);
    expect(outwardSide([...counterClockwise].reverse())).toBe(-1);
    expect(outwardSide([[0, 0], [5, 5]])).toBe(1);
  });
  it("adds legs from home and back to journeys and to single trips, never to home itself", async () => {
    const { groupTrips, routeFeatures } = await import("../scripts/trips.ts");
    const coordinates = new Map<string, [number, number]>([
      ["hollenbeck", [9.46, 53.43]],
      ["storvorde", [10.25, 57.0]],
      ["kalamos", [20.9, 38.6]],
      ["berlin", berlin],
    ]);
    const journey = [
      stop("a", "hollenbeck", [9.46, 53.43], "2025-05-24", "2025-05-25"),
      stop("b", "storvorde", [10.25, 57.0], "2025-05-25", "2025-06-01"),
    ];
    const kalamos = stop("k", "kalamos", [20.9, 38.6], "2025-04-27", "2025-05-02");
    const kalamosAgain = stop("k2", "kalamos", [20.9, 38.6], "2025-09-01", "2025-09-03");
    const early = stop("e", "storvorde", [10.25, 57.0], "2023-01-01", "2023-01-02");
    const atHome = stop("h", "berlin", berlin, "2025-10-01", "2025-10-01");
    const grouped = groupTrips(journey);
    const { trips, routes } = routeFeatures(
      grouped,
      [kalamos, kalamosAgain, early, atHome],
      coordinates,
      [home],
    );
    expect(trips[0]).toMatchObject({ stops: ["hollenbeck", "storvorde"], from: "home-berlin", to: "home-berlin" });
    const summary = routes.features.map((feature) => [
      feature.properties.group,
      feature.properties.kind,
      feature.properties.order,
    ]);
    expect(summary).toEqual([
      [trips[0].id, "leg", 0],
      [trips[0].id, "hop", 1],
      [trips[0].id, "leg", 2],
      // Repeat single trips share one lens; trips before the home began and
      // trips to the home city itself have no legs.
      ["place:kalamos", "leg", 0],
      ["place:kalamos", "leg", 1],
    ]);
    for (const feature of routes.features)
      expect(feature.id).toBe(feature.properties.id);
    const out = routes.features[0].geometry.coordinates;
    expect(out[0]).toEqual(berlin);
    expect(out[out.length - 1]).toEqual([9.46, 53.43]);
    const { trips: homeless } = routeFeatures(grouped, [], coordinates, []);
    expect(homeless[0].from).toBeUndefined();
  });
});
describe("focus expressions", () => {
  it("draw a journey only while revealed and dim other places without hiding them", async () => {
    const { scaleBand, revealed, undimmed, withVisibility } = await import("../src/map/expressions.ts");
    const focus = expression.createExpression(scaleBand(bands.focus, revealed), "focus");
    const pin = expression.createExpression(scaleBand(withVisibility(bands.pin), undimmed), "pin");
    if (focus.result !== "success" || pin.result !== "success") throw new Error("invalid expression");
    const at = (parsed: typeof focus, zoom: number, state: Record<string, number>) =>
      Number(parsed.value.evaluate({ zoom }, undefined, state));
    expect(at(focus, 5, {})).toBe(0);
    expect(at(focus, 5, { reveal: 1 })).toBe(1);
    expect(at(focus, 0.5, { reveal: 1 })).toBe(0);
    expect(at(pin, 10, { visibility: 1 })).toBe(1);
    expect(at(pin, 10, { visibility: 1, dim: 1 })).toBeCloseTo(0.3, 5);
    expect(at(pin, 10, { visibility: 0, dim: 0 })).toBe(0);
  });
});
describe("statistics", () => {
  type Resolved = ReturnType<typeof resolveVisits>[number] & { coordinates: [number, number] };
  const home = {
    id: "home-berlin",
    label: "Berlin",
    country: "DE",
    city: "Berlin",
    coordinates: [13.405, 52.52] as [number, number],
    since: "2019-01-01",
  };
  async function load(extra: Resolved[] = []) {
    const { computeStats } = await import("../scripts/stats.ts");
    const { publicVisit } = await import("../scripts/config.ts");
    const { assignDayTrips } = await import("../scripts/trips.ts");
    const { placeKey } = await import("../src/map/place-key.ts");
    const { readFileSync } = await import("node:fs");
    const cache = JSON.parse(readFileSync("verification/fixtures/geocache.json", "utf8"));
    const fixture = (await import("./fixtures/visits.ts")).default;
    const resolved = resolveVisits(validateConfig(fixture, cache), cache);
    const anchored = [...resolved.filter((visit) => visit.coordinates), ...extra] as Resolved[];
    const places = collapseVisits(anchored);
    // Day trips resolve to their base as the generator does, so `from` is published.
    const placeByKey = new Map(places.map((place) => [placeKey(place), place]));
    const bases = new Map(
      assignDayTrips(
        anchored.map((visit) => ({
          id: visit.id,
          placeId: placeByKey.get(placeKey(visit))!.id,
          country: visit.country,
          coordinates: visit.coordinates,
          ...(visit.date !== undefined ? { date: visit.date } : {}),
          ...(visit.dateRange !== undefined ? { dateRange: visit.dateRange } : {}),
        })),
      ).flatMap((visit) => (visit.from ? [[visit.id, visit.from] as const] : [])),
    );
    const visits = anchored.map((visit) => publicVisit({ ...visit, from: bases.get(visit.id) }));
    return { computeStats, visits, places };
  }
  it("derives totals from published visits only and matches an independent recomputation", async () => {
    const { computeStats, visits, places } = await load();
    const stats = computeStats(visits, places);
    expect(stats.countries).toBe(3);
    expect(stats.places).toBe(places.length);
    expect(stats.visits).toBe(visits.length);
    expect(stats.nights).toBe(4 + 5 + 4 + 4);
    expect(stats.longestStay).toEqual({ place: "paris-2021", label: "Paris", nights: 5 });
    expect(stats.years.map((row) => row.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(stats.byCountry[0]).toEqual({ country: "FR", places: 3, regions: 2, regionsOf: null, firstYear: 2021 });
    expect(stats.byCountry[1]).toEqual({ country: "DE", places: 2, regions: 2, regionsOf: null, firstYear: 2019 });
    expect(computeStats(visits, places, { regionsOf: { DE: 16 } }).byCountry[1].regionsOf).toBe(16);
    // The fixture's one day trip is a visit without nights, from Paris.
    expect(stats.dayTrips).toBe(1);
    expect(visits.find((visit) => visit.id === "versailles-2021")?.from).toBe("paris-2021");
    expect(JSON.stringify(stats)).not.toMatch(/coordinates|address/);
    expect(payloadViolations("stats.json", JSON.stringify(stats))).toEqual([]);
  });
  it("measures coverage against the 195 states and Natural Earth's continents", async () => {
    const { continents, states } = (await import("../data/continents.json")).default;
    const { countryCodes } = await import("../scripts/config.ts");
    expect(states).toHaveLength(195);
    for (const code of countryCodes) expect(continents[code as keyof typeof continents], code).toBeTruthy();
    expect(new Set(Object.values(continents)).size).toBe(7);
    const { computeStats, visits, places } = await load([
      { id: "mcmurdo", label: "McMurdo", country: "AQ", city: "McMurdo", coordinates: [166.67, -77.85], date: "2027-01-01" },
    ]);
    const { coverage } = computeStats(visits, places);
    expect(coverage).toEqual({
      states: 3,
      of: 195,
      territories: 1,
      continents: [
        { continent: "Europe", visited: 3, of: 44 },
        { continent: "Antarctica", visited: 1, of: 0 },
      ],
      continentsOf: 7,
    });
  });
  it("names every milestone by public id and recomputes each from the fixture", async () => {
    const { distanceKm } = await import("../scripts/trips.ts");
    const extra: Resolved[] = [
      { id: "tromso-2026", label: "Tromsø", country: "NO", city: "Tromsø", coordinates: [18.96, 69.65], dateRange: ["2026-01-10", "2026-01-14"] },
      { id: "cape-town", label: "Cape Town", country: "ZA", city: "Cape Town", coordinates: [18.42, -33.92] },
      { id: "mcmurdo", label: "McMurdo", country: "AQ", city: "McMurdo", coordinates: [166.67, -77.85], date: "2027-01-01" },
    ];
    const { computeStats, visits, places } = await load(extra);
    const at = (id: string) => places.find((place) => place.id === id)!.coordinates;
    const trips = [
      { id: "t1", label: "France, 2021", start: "2021-09-03", end: "2021-09-08", stops: ["paris-2021"] },
      { id: "t2", label: "Britain, 2024", start: "2024-04-12", end: "2024-04-20", stops: ["london-2024", "edinburgh-2025"] },
    ];
    const legs = [[home.coordinates, at("paris-2021")], [at("paris-2021"), home.coordinates]] as const;
    const stats = computeStats(visits, places, { trips, homes: [home], legs });
    expect(stats.journeys).toBe(2);
    expect(stats.milestones).toEqual([
      { kind: "first", place: "berlin-2019", date: "2019-07-14" },
      { kind: "distance", km: Math.round(2 * distanceKm(home.coordinates, at("paris-2021"))) },
      { kind: "furthest", place: "mcmurdo", home: "home-berlin", km: Math.round(distanceKm(home.coordinates, at("mcmurdo"))) },
      { kind: "journey", trip: "t2", nights: 8, stops: 2, dayTrips: 0, countries: 1 },
      { kind: "north", place: "tromso-2026" },
      { kind: "south", place: "mcmurdo" },
      { kind: "east", place: "mcmurdo" },
      { kind: "west", place: "edinburgh-2025" },
      { kind: "arctic", place: "tromso-2026", date: "2026-01-10" },
      { kind: "antarctic", place: "mcmurdo", date: "2027-01-01" },
      { kind: "equator", place: "mcmurdo", date: "2027-01-01" },
      { kind: "nights", country: "GB", nights: 8 },
      { kind: "returns", place: "berlin-2019", visits: 2 },
      { kind: "gap", from: "london-2024", to: "edinburgh-2025", days: 473 },
    ]);
    expect(payloadViolations("stats.json", JSON.stringify(stats))).toEqual([]);
    // An undated crossing still counts, without a date.
    const undated = computeStats(visits.filter((visit) => visit.id !== "mcmurdo"), places);
    expect(undated.milestones).toContainEqual({ kind: "equator", place: "cape-town" });
    // Without a home or journeys the dependent milestones are simply absent.
    const kinds = computeStats(visits, places).milestones.map((entry) => entry.kind);
    expect(kinds).not.toContain("furthest");
    expect(kinds).not.toContain("distance");
    expect(kinds).not.toContain("journey");
    const berlin = places.filter((place) => place.id === "berlin-2019").map((place) => ({ ...place, visitCount: 1 }));
    expect(computeStats(visits.slice(0, 1), berlin).milestones.map((entry) => entry.kind)).toEqual(["first"]);
  });
  it("compares years by firsts and extremes", async () => {
    const { computeStats, visits, places } = await load();
    const rows = computeStats(visits, places, { homes: [home] }).years;
    const year = (value: number) => rows.find((row) => row.year === value)!;
    expect(year(2019)).toMatchObject({ visits: 1, nights: 0, countries: 1, newCountries: 1, newPlaces: 1, longestStay: null });
    expect(year(2020)).toMatchObject({ newCountries: 0, newPlaces: 1, longestStay: { place: "munich-2020", nights: 4 } });
    expect(year(2021)).toMatchObject({ newCountries: 1, newPlaces: 2 });
    expect(year(2023)).toMatchObject({ visits: 1, newCountries: 0, newPlaces: 0, furthest: { place: "berlin-2019", km: 0 } });
    expect(year(2024).furthest).toEqual({ place: "london-2024", km: year(2024).furthest!.km });
    expect(year(2025)).toMatchObject({ newCountries: 0, newPlaces: 1 });
    expect(rows.map((row) => row.newCountries).reduce((a, b) => a + b, 0)).toBe(3);
    expect(rows.map((row) => row.newPlaces).reduce((a, b) => a + b, 0)).toBe(places.length);
  });
});
describe("day trips", () => {
  const visit = (
    id: string,
    placeId: string,
    start: string,
    end: string,
    extra: Partial<import("../scripts/trips.ts").TripVisit> = {},
  ): import("../scripts/trips.ts").TripVisit => ({
    id,
    placeId,
    country: placeId.startsWith("pl-") ? "PL" : "DE",
    coordinates: placeId.startsWith("pl-") ? [14.25, 53.91] : [14.19, 53.94],
    ...(start === end ? { date: start } : { dateRange: [start, end] as [string, string] }),
    ...extra,
  });
  const home = { id: "home-berlin", coordinates: [13.4, 52.5] as [number, number], since: "2024-04-25" };
  const ahlbeck = visit("a", "de-ahlbeck", "2026-08-07", "2026-08-13");
  const swinoujscie = visit("s", "pl-swinemunde", "2026-08-12", "2026-08-12");
  it("accepts the flag on a dated day only, without changing the identity", () => {
    const flagged = validateConfig({
      visits: [{ country: "PL", city: "Swinemünde", date: "2026-08-12", dayTrip: true }],
    });
    const plain = validateConfig({ visits: [{ country: "PL", city: "Swinemünde", date: "2026-08-12" }] });
    expect(flagged.visits[0].dayTrip).toBe(true);
    expect(flagged.visits[0].id).toBe(plain.visits[0].id);
    expect(() =>
      validateConfig({
        visits: [{ country: "PL", city: "Swinemünde", dateRange: ["2026-08-12", "2026-08-13"], dayTrip: true }],
      }),
    ).toThrow(/single dated day/);
    expect(() =>
      validateConfig({ visits: [{ country: "PL", city: "Swinemünde", dayTrip: true }] }),
    ).toThrow(/single dated day/);
    expect(() =>
      validateConfig({ visits: [{ country: "PL", date: "2026-08-12", dayTrip: true }] }),
    ).toThrow(/needs a city/);
    expect(() =>
      validateConfig({ visits: [{ country: "PL", city: "Swinemünde", date: "2026-08-12", dayTrip: false }] }),
    ).toThrow();
  });
  it("infers a day trip strictly inside a stay, the innermost when stays nest", async () => {
    const { assignDayTrips } = await import("../scripts/trips.ts");
    const inner = visit("i", "de-heringsdorf", "2026-08-10", "2026-08-13");
    const assigned = assignDayTrips([ahlbeck, inner, swinoujscie, visit("x", "de-x", "2026-08-11", "2026-08-11")]);
    expect(assigned.find((v) => v.id === "s")?.from).toBe("de-heringsdorf");
    expect(assigned.find((v) => v.id === "x")?.from).toBe("de-heringsdorf");
    expect(assigned.find((v) => v.id === "a")?.from).toBeUndefined();
    expect(assigned.find((v) => v.id === "i")?.from).toBeUndefined();
    // Arrival and departure days are on the way: a stop unless the owner says otherwise.
    const edge = visit("e", "pl-swinemunde", "2026-08-13", "2026-08-13");
    expect(assignDayTrips([ahlbeck, edge]).find((v) => v.id === "e")?.from).toBeUndefined();
    expect(
      assignDayTrips([ahlbeck, { ...edge, dayTrip: true }]).find((v) => v.id === "e")?.from,
    ).toBe("de-ahlbeck");
    // A flagged day with no stay around it is a day out from home, if there is one.
    const potsdam = visit("p", "de-potsdam", "2025-03-01", "2025-03-01", { dayTrip: true });
    expect(assignDayTrips([potsdam], [home])[0].from).toBe("home-berlin");
    expect(() => assignDayTrips([potsdam])).toThrow(/no stay or home covers 2025-03-01/);
    // Never from itself, never for a stay, never for an open range.
    expect(assignDayTrips([ahlbeck, visit("a2", "de-ahlbeck", "2026-08-10", "2026-08-10")])[1].from).toBeUndefined();
    expect(assignDayTrips([{ ...swinoujscie, dateRange: ["2026-08-12", ""] }])[0].from).toBeUndefined();
  });
  it("keeps a day trip out of the stops and lets it ride with its base's journey", async () => {
    const { assignDayTrips, groupTrips, routeFeatures } = await import("../scripts/trips.ts");
    // A week by the sea with an afternoon across the border is not a two-stop journey.
    const lone = groupTrips(assignDayTrips([ahlbeck, swinoujscie]));
    expect(lone).toEqual([]);
    const usedom = visit("u", "de-usedom", "2026-08-13", "2026-08-15");
    const grouped = groupTrips(assignDayTrips([ahlbeck, swinoujscie, usedom]));
    expect(grouped).toHaveLength(1);
    expect(grouped[0].trip).toMatchObject({
      stops: ["de-ahlbeck", "de-usedom"],
      start: "2026-08-07",
      end: "2026-08-15",
      label: "Germany and Poland, 2026",
    });
    expect(grouped[0].visits.map((v) => v.id)).toEqual(["a", "u", "s"]);
    // Stops alone identify the journey: the same digest with or without the day
    // trip, under a label that now names Poland too.
    const without = groupTrips(assignDayTrips([ahlbeck, usedom]))[0].trip;
    expect(without.label).toBe("Germany, 2026");
    expect(without.id.slice(-8)).toBe(grouped[0].trip.id.slice(-8));
    const coordinates = new Map<string, [number, number]>([
      ["de-ahlbeck", [14.19, 53.94]],
      ["de-usedom", [13.92, 53.87]],
      ["pl-swinemunde", [14.25, 53.91]],
      ["de-potsdam", [13.06, 52.4]],
    ]);
    const { trips, routes } = routeFeatures(grouped, [], coordinates, [home]);
    expect(trips[0]).toMatchObject({ from: "home-berlin", to: "home-berlin" });
    const summary = routes.features.map((f) => [f.properties.kind, f.properties.order, f.properties.place ?? ""]);
    expect(summary).toEqual([
      ["leg", 0, ""],
      ["hop", 1, ""],
      ["leg", 2, ""],
      ["excursion", 3, "pl-swinemunde"],
      ["excursion", 4, "pl-swinemunde"],
    ]);
    const lens = routes.features.filter((f) => f.properties.kind === "excursion");
    expect(lens[0].properties).toMatchObject({ from: "de-ahlbeck", km: expect.any(Number) });
    expect(lens[0].properties.km).toBeGreaterThan(3);
    expect(lens[0].properties.km).toBeLessThan(8);
    expect(lens[0].geometry.coordinates[0]).toEqual([14.19, 53.94]);
    expect(lens[0].geometry.coordinates.at(-1)).toEqual([14.25, 53.91]);
    expect(lens[1].geometry.coordinates[0]).toEqual([14.25, 53.91]);
    // Out and back bow to opposite sides, so the pair closes into a lens.
    const mid = Math.floor(lens[0].geometry.coordinates.length / 2);
    expect(Math.sign(lens[0].geometry.coordinates[mid][1] - 53.925)).not.toBe(
      Math.sign(lens[1].geometry.coordinates[mid][1] - 53.925),
    );
    // A lone stay draws its day trips under its own lens; a day out from home gets the home legs.
    const standalone = assignDayTrips(
      [ahlbeck, swinoujscie, visit("s2", "pl-swinemunde", "2026-08-10", "2026-08-10"), visit("p", "de-potsdam", "2025-03-01", "2025-03-01", { dayTrip: true })],
      [home],
    );
    const alone = routeFeatures([], standalone, coordinates, [home]);
    expect(alone.routes.features.map((f) => [f.properties.group, f.properties.kind])).toEqual([
      ["place:de-ahlbeck", "leg"],
      ["place:de-ahlbeck", "leg"],
      ["place:de-ahlbeck", "excursion"],
      ["place:de-ahlbeck", "excursion"],
      ["place:de-potsdam", "leg"],
      ["place:de-potsdam", "leg"],
    ]);
  });
  it("counts day trips as visits without nights, apart from the stays", async () => {
    const { computeStats } = await import("../scripts/stats.ts");
    const { publicVisit } = await import("../scripts/config.ts");
    const resolved = [
      { id: "a", label: "Seebad Ahlbeck", country: "DE", city: "Seebad Ahlbeck", coordinates: [14.19, 53.94] as [number, number], dateRange: ["2026-08-07", "2026-08-13"] as [string, string] },
      { id: "s", label: "Swinemünde", country: "PL", city: "Swinemünde", coordinates: [14.25, 53.91] as [number, number], date: "2026-08-12", from: "de-ahlbeck" },
      { id: "s2", label: "Swinemünde", country: "PL", city: "Swinemünde", coordinates: [14.25, 53.91] as [number, number], date: "2026-08-10", from: "de-ahlbeck" },
      { id: "r", label: "Rome", country: "IT", city: "Rome", coordinates: [12.5, 41.9] as [number, number], dateRange: ["2026-10-01", "2026-10-05"] as [string, string] },
    ];
    const places = collapseVisits(resolved).map((place) => ({
      ...place,
      ...(place.city === "Swinemünde" ? { dayTrips: 2 } : {}),
    }));
    const ahlbeckId = places.find((place) => place.city === "Seebad Ahlbeck")!.id;
    const visits = resolved.map((visit) => publicVisit({ ...visit, from: visit.from ? ahlbeckId : undefined }));
    const trip = { id: "t", label: "Germany and Poland, 2026", start: "2026-08-07", end: "2026-08-13", stops: [ahlbeckId] };
    const stats = computeStats(visits, places, { trips: [trip] });
    expect(stats).toMatchObject({ visits: 4, dayTrips: 2, nights: 10 });
    expect(stats.years[0]).toMatchObject({ year: 2026, visits: 4, dayTrips: 2, nights: 10, countries: 3 });
    expect(stats.milestones).toContainEqual({ kind: "journey", trip: "t", nights: 6, stops: 1, dayTrips: 2, countries: 2 });
    expect(stats.milestones).toContainEqual({ kind: "daytrips", place: ahlbeckId, dayTrips: 2 });
    // The gap between trips is measured between stays; a day trip inside one never shortens it.
    expect(stats.milestones).toContainEqual({ kind: "gap", from: ahlbeckId, to: places.find((p) => p.city === "Rome")!.id, days: 49 });
    expect(payloadViolations("stats.json", JSON.stringify(stats))).toEqual([]);
    expect(payloadViolations("visits.json", JSON.stringify(visits))).toEqual([]);
    expect(payloadViolations("places.json", JSON.stringify(places))).toEqual([]);
    expect(
      payloadViolations("visits.json", JSON.stringify([{ ...visits[1], base: "x" }])),
    ).toHaveLength(1);
  });
  it("shows a day trip's ring and lens only once it stands clear of its base", async () => {
    const { apart, apartKm, bandAt, revealed } = await import("../src/map/expressions.ts");
    expect(bandAt(bands.focus, 0)).toBe(0);
    expect(bandAt(bands.focus, 1.625)).toBeCloseTo(0.5, 5);
    expect(bandAt(bands.focus, 10)).toBe(1);
    expect(apartKm(6)).toBeGreaterThan(apartKm(8));
    expect(apartKm(12)).toBe(0);
    const parsed = expression.createExpression(apart(bands.focus, revealed), "focus");
    if (parsed.result !== "success") throw new Error("invalid expression");
    const at = (zoom: number, km: number, reveal = 1) =>
      Number(parsed.value.evaluate({ zoom }, { type: "Point", properties: { km } } as never, { reveal }));
    // A 5 km lens is invisible at the continent view and fully drawn by zoom 9.
    expect(at(4, 5)).toBe(0);
    expect(at(9, 5)).toBe(1);
    expect(at(11, 0.3)).toBe(0);
    expect(at(13, 0.3)).toBe(1);
    // A 400 km day trip reads as soon as the journey itself does.
    expect(at(3, 400)).toBe(1);
    expect(at(9, 5, 0)).toBe(0);
    // Monotonic: once apart, a mark never hides again as the viewer zooms in.
    for (let zoom = 0; zoom < 16; zoom += 0.25) expect(at(zoom + 0.25, 50)).toBeGreaterThanOrEqual(at(zoom, 50));
  });
});
describe("authoring commands", () => {
  const source = `import type { Config } from "../scripts/config.ts";

const config: Config = {
  publishPrecision: "city",
  visits: [
    {
      country: "DE",
      city: "Berlin",
      date: "2024-04-25",
    },
  ],
};
export default config;
`;
  it("parses a day trip flag into the visit and its formatted entry", async () => {
    const { formatVisit, parseVisitArgs, visitFromRow } = await import("../scripts/authoring.ts");
    const { visit } = parseVisitArgs(["PL", "Swinemünde", "2026-08-12", "--day-trip"]);
    expect(visit).toEqual({ country: "PL", city: "Swinemünde", date: "2026-08-12", dayTrip: true });
    expect(formatVisit(visit)).toContain("dayTrip: true,");
    expect(() => parseVisitArgs(["PL", "Swinemünde", "2026-08-12..2026-08-13", "--day-trip"])).toThrow(/single dated day/);
    expect(
      visitFromRow({ line: 2, fields: { country: "pl", city: "Swinemünde", start: "2026-08-12", end: "", daytrip: "yes" } }),
    ).toMatchObject({ dayTrip: true });
    expect(
      visitFromRow({ line: 2, fields: { country: "pl", city: "Swinemünde", start: "2026-08-12", end: "", daytrip: "" } }).dayTrip,
    ).toBeUndefined();
  });
  it("parses arguments into a validated visit", async () => {
    const { parseVisitArgs } = await import("../scripts/authoring.ts");
    expect(parseVisitArgs(["de", "Wendisch Rietz", "2025-04-04..2025-04-06", "--trip", "Spring"]).visit).toEqual({
      country: "DE",
      city: "Wendisch Rietz",
      trip: "Spring",
      dateRange: ["2025-04-04", "2025-04-06"],
    });
    expect(parseVisitArgs(["GR", "Kalamos", "2025-04-27", "--dry-run"])).toMatchObject({ dryRun: true, geocode: true });
    expect(() => parseVisitArgs(["XX", "Nowhere", "2025-01-01"])).toThrow();
    expect(() => parseVisitArgs(["DE", "Berlin", "2025-13-01"])).toThrow();
    expect(() => parseVisitArgs(["DE", "Berlin"])).toThrow(/Usage/);
  });
  it("inserts a visit at the end of the array without touching other bytes", async () => {
    const { insertVisit } = await import("../scripts/authoring.ts");
    const result = insertVisit(source, { country: "GR", city: "Kalamos", dateRange: ["2025-04-27", "2025-05-02"] });
    const expected = source.replace(
      `      date: "2024-04-25",
    },
  ],`,
      `      date: "2024-04-25",
    },
    {
      country: "GR",
      city: "Kalamos",
      dateRange: ["2025-04-27", "2025-05-02"],
    },
  ],`,
    );
    expect(result).toBe(expected);
    // Inserting into an emptied array and into an array without a trailing comma both parse.
    const empty = insertVisit(source.replace(/visits: \[[\s\S]*?\],/, "visits: [],"), { country: "FR", city: "Paris", date: "2026-05-14" });
    expect(empty).toContain('city: "Paris"');
    const noComma = insertVisit(source.replace("    },\n  ],", "    }\n  ],"), { country: "FR", city: "Paris", date: "2026-05-14" });
    expect(noComma).toContain('    },\n    {\n      country: "FR"');
    for (const text of [result, empty, noComma])
      expect(() => validateConfig(evalConfig(text))).not.toThrow();
  });
  it("refuses duplicates by country, folded city and dates", async () => {
    const { duplicateOf } = await import("../scripts/authoring.ts");
    const config = { visits: [{ country: "SE", city: "Ödsmål", dateRange: ["2025-06-18", "2025-06-24"] as [string, string] }] };
    expect(duplicateOf(config, { country: "SE", city: "odsmal", dateRange: ["2025-06-18", "2025-06-24"] })).toBeDefined();
    expect(duplicateOf(config, { country: "SE", city: "Ödsmål", date: "2025-06-18" })).toBeUndefined();
  });
  it("reads quoted CSV rows into visits with line numbers", async () => {
    const { parseCsv, visitFromRow } = await import("../scripts/authoring.ts");
    const rows = parseCsv('country,city,start,end,label,trip\r\nde,"Wendisch Rietz",2025-04-04,2025-04-06,,\nGR,Kalamos,2025-04-27,,,"Spring, 2025"\n\n');
    expect(rows.map((row) => row.line)).toEqual([2, 3]);
    expect(visitFromRow(rows[0])).toEqual({ country: "DE", city: "Wendisch Rietz", dateRange: ["2025-04-04", "2025-04-06"] });
    expect(visitFromRow(rows[1])).toEqual({ country: "GR", city: "Kalamos", date: "2025-04-27", trip: "Spring, 2025" });
    expect(() => visitFromRow({ line: 9, fields: { country: "GR", city: "", start: "2025-01-01" } })).toThrow(/line 9/);
  });
});
function evalConfig(text: string): unknown {
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${js.replace(/export default config;\s*$/, "")}\nreturn config;`)();
}

describe("day and night themes", () => {
  const isLight: ExpressionSpecification = ["==", ["to-string", ["global-state", "theme"]], "light"];
  it("switches differing colours at the leaf, inside zoom interpolation", () => {
    const dark = { "fill-color": ["interpolate", ["linear"], ["zoom"], 0, "#080f18", 6, "#121c27"], "fill-opacity": 0.5 };
    const light = { "fill-color": ["interpolate", ["linear"], ["zoom"], 0, "#d3dce4", 6, "#121c27"], "fill-opacity": 0.5 };
    const merged = mergeThemes(dark, light, isLight) as Record<string, unknown[]>;
    expect(merged["fill-color"].slice(0, 3)).toEqual(["interpolate", ["linear"], ["zoom"]]);
    expect(merged["fill-color"][4]).toEqual(["case", isLight, "#d3dce4", "#080f18"]);
    expect(merged["fill-color"][6]).toBe("#121c27");
    expect(merged["fill-opacity"]).toBe(0.5);
  });
  it("refuses palettes that differ in anything but colour", () => {
    expect(() => mergeThemes({ "line-width": 1 }, { "line-width": 2 }, isLight)).toThrow(/line-width/);
  });
  it("evaluates each palette from the theme global state", () => {
    // The generated style itself is gated in verification/style.ts, after the build.
    const merged = mergeThemes("#080f18", "#d3dce4", isLight);
    const colour = (theme?: string) => {
      const parsed = expression.createExpression(merged, "merged", null, theme ? { theme } : {});
      if (parsed.result === "error") throw new Error(JSON.stringify(parsed.value));
      return String(parsed.value.evaluate({ zoom: 2 }));
    };
    expect(colour("dark")).toBe(colour());
    expect(colour("light")).not.toBe(colour("dark"));
  });
  it("seeds a sparse, repeatable starfield", () => {
    const stars = starfield();
    expect(starfield()).toEqual(stars);
    expect(stars.length).toBe(105);
    expect(stars.filter((star) => star.a < 0.4).length / stars.length).toBeGreaterThan(0.6);
    expect(stars.every((star) => star.x >= 0 && star.x < starTile && star.r <= 1.25)).toBe(true);
  });
  it("fades stars as the globe fills the view", () => {
    expect(starOpacity(1.8)).toBe(1);
    expect(starOpacity(2.75)).toBeCloseTo(0.5);
    expect(starOpacity(4)).toBe(0);
  });
  it("sizes the halo to the globe's visible limb", () => {
    // Measured on the 1440×900 overview: the limb spans x ≈ 439–1001.
    expect(globeRadius(1.8, 35, 900, 36.87)).toBeCloseTo(281, -1);
    expect(globeRadius(3, 0, 900, 36.87)).toBeGreaterThan(globeRadius(2, 0, 900, 36.87));
  });
});
