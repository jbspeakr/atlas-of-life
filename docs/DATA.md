# Data authoring

`data/visits.ts` is the only routinely hand-edited file. Its type comes from the strict Zod schema in `scripts/config.ts`; build-time validation names the failing visit and field. Unknown keys are rejected. The shipped data is limited to `id`, `label`, `country`, `region`, `city`, `coordinates`, `date`, `dateRange`, `tags`, and `visitCount`. Names of people, notes, photographs, stories, addresses and geocoder provenance are not public fields.

```ts
const config: Config = {
  publishPrecision: 'city',
  visits: [
    { id: 'berlin-2019', label: 'Berlin', country: 'DE', city: 'Berlin', region: 'DE-BE', date: '2019-07-14' },
    { id: 'france', label: 'France', country: 'FR' },
    { id: 'bavaria', label: 'Bavaria', country: 'DE', region: 'Bavaria' },
    { id: 'public-landmark', label: 'Brandenburg Gate', country: 'DE', city: 'Berlin', coordinates: [13.3777, 52.5163], publishPrecision: 'exact' },
  ],
};
```

Use a unique, stable lowercase hyphenated slug. Deep links use `/#/place/slug`; repeat-city visit IDs also resolve to the canonical city pin. `country` is an uppercase assigned ISO alpha-2 code, with the documented Natural Earth `XK` extension for Kosovo. `UK` is not accepted: use `GB`. Natural Earth lookup uses `ISO_A2_EH`, avoiding its `-99` values for France and Norway; Kosovo maps to `XK`/`XKX`.

A country-only record lights a country without a pin. Region-only records light that region. Region may be an ISO 3166-2 code or the exact upstream region name. Region names are matched only within the specified country and converted to stable codes before publication. If omitted on a city/address, the build resolves region membership from the published point. Every record, including partial records, receives a boundary interior anchor for the public timeline data. Polygons store their full bounding box and a pole-of-inaccessibility label anchor, not an offshore centroid. Full country bounds deliberately include overseas territory.

Dates are real `YYYY-MM-DD` calendar dates. Choose `date` or `dateRange`, never both. A range is a two-element tuple with `''` for an open endpoint: `['2020-01-01', '']`. Reversed ranges and impossible dates fail. Undated places remain lit at every timeline position. The scrubber means **visited by this year**; it is cumulative, with a smooth fractional-year transition. Original public visit dates are retained separately so a collapsed pin's caption does not invent a continuous trip between two visits.

Cities collapse by country, resolved region and NFKC/whitespace/case-normalized city name. The first chronological visit supplies the canonical pin ID and location; counts and tag unions summarize repeat visits, while the caption uses the original dates. Consequently an exact landmark that shares a city with an earlier city visit remains part of that city's single pin; exact precision does not create a second pin. Give the geographic settlement as `city`, not a person's name.

## Precision and caches

City publication is the default, including for authored explicit street coordinates. A warm city result is required; if missing, run `npm run geocode`. For deliberate public landmark placement, a per-visit `publishPrecision: 'exact'` overrides the default. In exact mode, authored coordinates win without any geocoding. Global exact mode is also supported, but is a deliberate disclosure decision. Do not commit private source addresses into a public repository merely because the built output is safe.

Geocode keys are SHA-256 hashes of a normalized query, country filter and query kind. The committed cache includes query-result coordinates, country, optional canonical region/city and source provenance. `npm run geocode` adds missing entries; to refresh a specific result, remove its cache entry deliberately and rerun. Warm-cache runs make no network requests. Set `NOMINATIM_CONTACT` for live requests. The script obeys a minimum 1.1-second interval, rejects ambiguous candidates with a confidence gap below 0.05, and fails instead of choosing a plausible wrong place. Explicit exact coordinates are the escape hatch for genuine ambiguity.

Normal builds never call Nominatim. Boundary-only cache misses can download pinned Natural Earth sources or discover a per-country geoBoundaries commit; URLs and SHA-256 values are recorded in `data/sources.json`. Commit that manifest and the warmed geocache after adding places. Full boundary downloads are ignored in `data/.geocache/`; committed selected boundary fixtures make the example and verification build fully offline. A checksum mismatch is a hard error, not a reason to silently refetch different data. New label glyph ranges are likewise vendored from the pinned basemap-assets revision.

`ATLAS_FIXTURE=1` selects the committed verification config, warm cache, selected boundaries and tile bytes regardless of changes to the owner's data or production archive. Fixture builds forbid geocode and boundary/glyph downloads. The verifier audits public JSON, embedded JavaScript place literals and actual GeoJSON pin geometry against precision-safe expected coordinates.
