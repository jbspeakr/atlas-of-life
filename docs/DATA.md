# Data authoring

`data/visits.ts` is the only routinely hand-edited file. A visit is **country, city and a date or date range**. IDs and labels are generated, geocoding finds coordinates, and the build discovers the region from the published point.

```ts
import type { Config } from "../scripts/config.ts";

const config: Config = {
  home: { country: "DE", city: "Berlin", since: "2024-04-25" },
  visits: [
    { country: "GR", city: "Kalamos", dateRange: ["2025-04-27", "2025-05-02"] },
  ],
};
export default config;
```

## Commands

```sh
NOMINATIM_CONTACT=you@example.org npm run add -- DE "Wendisch Rietz" 2025-04-04..2025-04-06
npm run add -- GR Kalamos 2025-04-27 --trip "Spring 2025" --dry-run
npm run import -- trips.csv
NOMINATIM_CONTACT=you@example.org npm run geocode   # after editing by hand
```

`add` validates, appends in the file's own style, refuses a duplicate (same country, folded city and dates), warms the geocache and prints the resolved point. `--region`, `--label` and `--trip` set the optional fields; `--dry-run` prints without writing; `--no-geocode` defers the cache step. `import` reads a CSV with the header `country,city,start,end,label,trip[,region]`, skips rows already present and aborts before writing on any invalid row. GPX or timeline exports are not imported: they would need reverse geocoding of many points against Nominatim's usage policy. After any change, run `npm run build` and commit the config, `data/geocache.json` and `data/sources.json`.

## Fields

- `country`: an uppercase ISO alpha-2 code (`GB`, not `UK`), plus `XK` for Kosovo.
- `city`: the settlement's own name. If country plus city is ambiguous, geocoding fails rather than guessing; add a `region` (a boundary code or exact upstream name) to disambiguate.
- `date` or `dateRange`, never both. Dates are real `YYYY-MM-DD` dates; a range has two endpoints, with `''` for an open one (`['2020-01-01', '']`). Undated visits stay lit at every timeline position.
- `trip`: an optional public label that groups visits into one journey across a gap.
- `label` and `id`: optional overrides for a curated link or a landmark name; unnecessary for ordinary cities.
- `publishPrecision: 'exact'` with `coordinates`: a deliberate public landmark placement. Everything else publishes at city precision, including an authored street coordinate.

Unknown keys are rejected. Country-only and region-only records are also accepted.

## Identity

An ID is a readable prefix and eight hex characters of a hash of the visit's geographic and date identity, for example `de-berlin-4f1c09ab`. Reordering unrelated visits does not change it; changing a visit's country, city or dates does. A collision within one configuration gets an occurrence suffix. Deep links are `/#/place/<id>`; a moved camera is `/#/view/<zoom>/<lat>/<lng>`; either accepts `?through=YYYY-MM-DD` and `&mode=only`.

Repeat visits to one city collapse into one place: the first chronological visit supplies the pin, and each visit keeps its own dates.

## Home

`home` is where journeys start and end: `{ country, city, since?, label?, region? }`. It is also a place lived in: the home city joins the places under the home's own ID for the whole period it was home, lights its region and country and counts in the places, regions, countries and coverage. It is **not a trip**: it draws a ring rather than a pin, never joins a journey or earns a leg, and stays out of the visit count, the nights, the year rows and the dated milestones. The timeline gains a position at `since`, so the atlas opens at home. Do not also add everyday visits to the home city.

If you move, list the homes with their own `since`; each ends the day before the next begins, and a journey leaves from the home in effect on its first day and returns to the one in effect on its last. Only the first home may omit `since`. Homes publish at city precision only. **The home city is public**; a `label` shows a different name, but the ring still marks the city.

## Journeys

Dated city visits form a journey when each starts no later than the day after the previous one ends; two or more visits are required, and open-ended or undated visits never join. With a home set, the journey gains a leg out and a leg back. A dated trip to a single place gets the same pair. To group across a gap or to name a journey, give the visits the same `trip` label; **that label is public**. Generated labels list the countries in order with the year, for example "Denmark, Norway and Sweden, 2025". Journeys publish to `trips.json` (id, label, dates, stop IDs, home IDs) and `routes.json` (one arc per hop or leg); they never carry addresses, notes or names.

## Regions

Geocoder administrative codes are provenance, not boundary identifiers. The build locates each city's point inside the country's geoBoundaries gbOpen ADM1 polygons, falling back to Natural Earth, and publishes that polygon's own identity: Kalamos resolves to Attica, and Reggio Calabria to Italy's *Sud* macro-area, because that is what the pinned source contains. A city outside every polygon keeps its pin and country with a build warning; no nearest-polygon guess is made. An authored `region` is a constraint: the point must lie inside it.

## Numbers

`stats.json` carries totals, coverage, milestones and one row per year, all derived from the public visits, places, journeys and homes; it names places, homes and journeys by their public IDs only and never carries a coordinate. Coverage counts visited countries against the 195 United Nations member and observer states, with any other code (a territory such as Greenland or Hong Kong) counted separately, and against the states of each of the seven continents. `data/continents.json` holds that table: Natural Earth's `CONTINENT` for every accepted code, the UN M49 geoscheme for the ocean states and territories Natural Earth files under "Seven seas", and the list of states. `npm run continents` regenerates it from the cached Natural Earth file after a non-fixture `npm run generate`. Region coverage ("4 of 16") counts the subdivisions in the country's pinned boundary source.

Milestones are the first dated visit, the crow-flies total of every drawn hop and home leg, the furthest place from the home in effect on the visit's first day (the first home before any `since`), the longest journey by nights, the northern-, southern-, eastern- and westernmost places, the first visit north of the Arctic Circle, south of the Antarctic Circle and south of the equator, the country with the most nights, the most returned-to place and the longest stretch between dated visits. Each exists only when the data supports it: no home means no furthest point, one country means no "most nights". Year rows add the countries and places first seen that year, the year's furthest point and its longest stay.

## Caches and precision

Geocode keys hash the normalised query, country and query kind. `npm run geocode` adds missing entries and makes no request for warm ones; to refresh a result, delete its entry and rerun. Live requests carry `NOMINATIM_CONTACT`, wait at least 1.1 s, match settlement names and fail on ambiguity. Builds never call Nominatim. Missing boundaries download from the pinned sources in `data/sources.json`; a checksum mismatch is an error, never a silent refetch. Full boundary downloads live in the ignored `data/.geocache/`.

Names of people, notes, photographs, source addresses, precision flags and geocoder provenance are never public fields. The verifier audits every public JSON, the embedded place literals and the GeoJSON pin geometry against city-precision expectations on every run. `ATLAS_FIXTURE=1` selects the committed fictional configuration and forbids every download.
