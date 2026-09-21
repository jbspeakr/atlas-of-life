# Data authoring

`data/visits.ts` is the only routinely hand-edited file. For a city visit, supply **country, city, and a date or date range**. IDs and display labels are generated; geocoding finds coordinates, and the build discovers region membership from the published point. Tags are not supported.

```ts
import type { Config } from "../scripts/config.ts";

const config: Config = {
  visits: [
    { country: "DE", city: "Berlin", date: "2024-04-25" },
    {
      country: "GR",
      city: "Kalamos",
      dateRange: ["2025-04-27", "2025-05-02"],
    },
  ],
};
export default config;
```

After adding cities, run:

```sh
NOMINATIM_CONTACT=you@example.org npm run geocode
npm run build
```

Use your own email or project contact URL. The first command populates `data/geocache.json`; the second validates and generates the map. Commit the config, geocache and updated `data/sources.json`, then deploy `dist/`. Neither coordinates nor region codes need to be copied back into your visits.

`country` is an uppercase assigned ISO alpha-2 code, with the Natural Earth `XK` extension for Kosovo. Use `GB`, not `UK`. Dates are real `YYYY-MM-DD` calendar dates. Choose `date` or `dateRange`, never both. A range has two endpoints, with `''` for an open endpoint: `['2020-01-01', '']`. Reversed ranges and impossible dates fail. Undated places remain lit at every timeline position. The scrubber means **visited by this year**.

Generated IDs combine a readable country/city prefix with a hash of normalized geographic/date identity. Reordering unrelated visits does not change them; Unicode names remain distinct even when their readable slugs coincide. Identical repeated entries receive occurrence suffixes. Changing a visit's identifying geography or dates changes its generated link. Optional explicit `id` and `label` overrides remain useful for permanent curated links and landmark labels, but are unnecessary for ordinary city entries. Deep links use `/#/place/<id>`.

Repeat cities collapse by country, resolved boundary and normalized city name. Keep one entry per trip: the first chronological visit supplies the canonical pin, and the caption retains the original trip dates rather than inventing continuous stays. Public per-visit rows carry `visitCount: 1` for city/address visits; boundary-only records omit it.

## Automatic region discovery

Geocoder administrative codes are provenance, **not boundary identifiers**. Nominatim and polygon providers differ in administrative levels, codes and dates. The build locates each city point within the preferred country's geoBoundaries gbOpen ADM1 polygons, then uses Natural Earth when needed. Geometry without an ISO code retains a stable, country/provider-scoped identifier instead of being discarded.

For example, Kalamos's cached `GR-A2` resolves spatially to Attica (`GR-AT` in gbOpen). Lampeland resolves to Viken in the pinned 2022 Norwegian dataset despite its newer cached `NO-33`. Italy's gbOpen ADM1 contains five macro-areas, so Reggio Calabria resolves to **Sud**, not a fabricated Calabria polygon. These are the provider's subdivisions, not a promise of current ISO administrative geography. Source year, subdivision type, immutable URL and checksum are retained in the manifest when discovering datasets.

If neither valid source contains a city, its pin and country remain visible, with a build warning and no invented region. No nearest-polygon guess is made. A country with no subdivisions does not need a fabricated ADM1 polygon. Network failures, malformed data and checksum mismatches remain errors rather than being mistaken for missing coverage.

Advanced country-only and region-only records still work. An explicitly authored `region` is a constraint, not a hint to ignore: use a supported boundary code or exact upstream name, and any supplied point must lie inside it. Names are resolved within the country to the chosen boundary ID. Region discovery uses the unsimplified source geometry; published polygons have coarse/fine LODs, full bounds and interior label anchors.

## Ambiguous place names

Country plus city cannot uniquely identify every place on Earth. Fresh geocoding matches a settlement's own name or upstream alternative names, not the name of its containing municipality. Multiple matching settlements fail rather than using popularity as proof of your intent. Add an optional geographic qualifier when genuinely necessary; do not invent dates or accept the wrong town just to pass a build. Deliberate exact coordinates remain available for public places. Existing warm results are retained until explicitly refreshed.

The cache key includes the authored query context, including optional region constraints. Changing a qualifier requires another geocode lookup. When an address supplies the otherwise missing region, its city lookup retains that context to avoid selecting a different same-named city.

## Precision and caches

City publication is the default, including for authored explicit street coordinates. A warm city result is required; if missing, run `npm run geocode`. For deliberate public landmark placement, a per-visit `publishPrecision: 'exact'` overrides the default. In exact mode, authored coordinates win without any geocoding. Global exact mode is also supported, but is a deliberate disclosure decision. Do not commit private source addresses into a public repository merely because the built output is safe.

Geocode keys are SHA-256 hashes of a normalized query, country filter and query kind. The committed cache includes coordinates, country, optional settlement/administrative provenance and source URL. `npm run geocode` adds missing entries; to refresh a specific result, remove its cache entry deliberately and rerun. Warm-cache runs make no network requests. Live requests use `NOMINATIM_CONTACT`, a minimum 1.1-second interval, settlement-name/alternative-name matching and ambiguity checks. Unknown configuration keys are rejected. Names of people, notes, photographs, stories, source addresses, precision flags and geocoder provenance are never public visit fields.

Normal builds never call Nominatim. Boundary-only cache misses can download pinned Natural Earth sources or discover a per-country geoBoundaries commit; URLs and SHA-256 values are recorded in `data/sources.json`. Commit that manifest and the warmed geocache after adding places. Full boundary downloads are ignored in `data/.geocache/`; committed selected boundary fixtures make the example and verification build fully offline. A checksum mismatch is a hard error, not a reason to silently refetch different data. New label glyph ranges are likewise vendored from the pinned basemap-assets revision.

`ATLAS_FIXTURE=1` selects the committed verification config, warm cache, selected boundaries and tile bytes regardless of changes to the owner's data or production archive. Fixture builds forbid geocode and boundary/glyph downloads. The verifier audits public JSON, embedded JavaScript place literals and actual GeoJSON pin geometry against precision-safe expected coordinates.
