# Atlas of a Life

A quiet, static night-sky atlas of places visited. Globe → countries → regions → places is one continuous MapLibre zoom, not three screens. The only authored content is geography, optional dates and non-personal tags. Code is MIT; geographic data keeps its upstream licences.

## Run locally

Requires Node 22.12+ and npm. Run `npm ci`, then `npm run dev`. The first generation installs the committed 22.3 MB preview tile archive if no local archive exists. It has global z0–3 and six small city windows through z14; it is a deterministic demonstration, **not** the complete bundled basemap. No account or live geocoder is needed for the included example. The dates are fictional and every cached location is public.

`npm run build` produces `dist/`; `npm run preview` serves it. Use `VITE_BASE=/some/subpath/ npm run build` for a subpath, or retain the default relative `./` base. `npm run geocode` is the explicit cache-warming step. `npm test` runs the same unit contracts used by verification. `npm run analyze` generates `dist/bundle-analysis.html`.

Append `?tag=coast` to share a geographically tagged view; it combines with the year scrubber, and “Show all” clears it. Tags change what is illuminated, not the single warm accent palette.

## Add a place

Edit `data/visits.ts` and add a visit with a unique slug, label and uppercase country code.
Add a region, city or address, and optionally dates, tags or an explicit landmark precision override.
Run `NOMINATIM_CONTACT=you@example.org npm run geocode` if the required city/address is not cached.
Run `npm run build`, commit the config and updated caches/manifest, then redeploy `dist/`.

## Privacy first

Publication precision defaults to `city`. Even explicit street coordinates are replaced by the warm city's coordinates unless that visit explicitly requests `publishPrecision: 'exact'`. Coordinates alone do not bypass the publication policy. Exact coordinates bypass geocoding when exact publication was intentionally selected. Source addresses, precision flags and cache provenance never enter production payloads. Do not publish your repository with real private addresses in it: **the build protects `dist/`, not Git history**. See [data authoring](docs/DATA.md).

## Basemap deployment

### Remote archive

Set `VITE_BASEMAP=remote`, `VITE_BASEMAP_URL` to your archive URL, and `VITE_TILE_ORIGINS` to any exact redirect origins reported by the hosting probe. Explicit remote mode refuses a missing URL. With no environment configured the local sample remains usable; no unrelated public tile service is silently selected. The preferred production host is a **Hugging Face dataset repository pinned to a commit SHA**, based on live range/CORS/browser measurements; publishing your own extract still requires your account.

Run `npm run verify:hosting -- URL --origin https://your-site.example --min-zoom 0 --max-zoom 14 --bounds -180,-85.0511287,180,85.0511287` before deploying. Dated `build.protomaps.com` archives are extraction inputs, never browser URLs.

Without overrides, the hosting probe requires vector Protomaps layers, z0–14 and global bounds. Transport success on a public sample is not an app-compatibility certificate: the measured HF sample is an MGRS archive, not the basemap to deploy. For a country-only archive without city detail, pass `--max-zoom 6`.

`npm run tiles:publish -- --help` describes the `hf` CLI publishing command. It stages only the archive and an OSM-derived dataset card, uploads them, verifies remote identity, and writes a full immutable resolve URL into `.env.production`. It never uploads `data/visits.ts`. Authentication and permission to write your dataset are required. Read the [measured hosting decisions](docs/DECISIONS.md), including the unverified Storage Bucket prerequisite.

### Fully bundled archive

Install [`pmtiles`](https://docs.protomaps.com/pmtiles/cli) and [`tile-join` from Tippecanoe](https://github.com/felt/tippecanoe). On macOS, `brew install tippecanoe` supplies `tile-join`; release binaries/source builds support Linux. Then run:

```sh
npm run generate
npm run basemap:build -- https://build.protomaps.com/20260914.pmtiles src/generated/places.json /tmp/new-basemap.pmtiles
mv /tmp/new-basemap.pmtiles public/tiles/basemap.pmtiles
VITE_BASEMAP=bundled npm run build
```

Find a current source at [Protomaps builds](https://maps.protomaps.com/builds); dated URLs expire. The script checks prerequisites, extracts global z0–6, extracts z7–14 within 20 km of each city, merges overlapping tile coordinates without duplicated features, verifies the archive and warns above 250 MB. `CITY_PADDING_KM` changes the coverage radius. The output path must not exist, protecting an existing archive until replacement is explicit. A complete example build was exercised: **211,759,571 bytes**, global z0–6 plus six city windows through z14. The same archive can be hosted remotely or bundled; only its URL changes.

## Verification, not guesswork

```sh
npm run verify -- --quick
npm run verify
npm run verify:approve
npm run verify -- --set-baseline
```

Quick mode runs static, unit, cold fixture generation and payload budgets in under 60 seconds; measured inner-loop runs take about 8 seconds on an Apple M1. Full mode serves the immutable fixture under `/atlas/`, uses pinned Chromium/DPR/viewport, traces five real camera choreographies, audits origins, tests keyboard and reduced motion, runs axe and compares six exact PNGs. Install Chromium with `npx playwright install chromium`. `verification/report.json` contains every measured gate, thresholds, deltas and the lexicographic objective. Missing output or baselines fail; only `verify:approve` writes visual baselines. Raw traces and diff images go to `verification/artifacts/`.

Normal-motion startup and camera performance are measured separately from deterministic visual capture. Cold FCP uses CDP 150 ms latency / 1.6 Mbps down; warm FCP proves HTTP cache use. Static serving uses ordinary gzip compression for text, but never compresses PMTiles byte ranges. Performance measurements require real GPU acceleration; software renderers fail visibly. The CI workflow therefore targets a provisioned self-hosted `macOS`, `ARM64`, `atlas-gpu` runner, matching the approved platform. A runner and Pages/Cloudflare permissions must be supplied before hosted CI can execute.

Current measured application JavaScript is approximately **366 KB gzip**, CSS **8.9 KB**, self-hosted WOFF2 **31.1 KB**, and all generated boundary LODs **251 KB gzip**. The full report is authoritative; [evolution](docs/EVOLUTION.md) records measured changes rather than visual guesses.

## Static hosting and security

The Vite build injects a restrictive CSP: scripts/fonts/styles from self, only explicit tile/redirect connect origins, blob workers for MapLibre, data/blob image decoding, no objects, no form submissions. MapLibre's positioned DOM requires `style-src-attr 'unsafe-inline'`; script execution does **not** permit inline or eval. Deploy over HTTP(S), not `file://`. `_headers` is included for Cloudflare-compatible hosts. Hashed assets get a one-year immutable policy; when replacing an un-hashed archive, change its URL or purge caches. GitHub Pages controls its own cache headers and cannot honour `_headers`; use an immutable remote archive there. Do not assume a host supports byte ranges: run the probe. Never gzip a PMTiles object at the CDN.

The workflow builds and deploys GitHub Pages after full verification; a Cloudflare Pages alternative is commented alongside it. Configure repository variables `VITE_BASEMAP_URL` and `VITE_TILE_ORIGINS`. Pull requests receive the objective table and verification artifacts. Fork PRs do not receive write-token comment permissions.

Full GPU verification runs for repository pushes and trusted same-repository PRs. Fork changes must be reviewed and mirrored onto a trusted branch before using a self-hosted runner; do not run untrusted code on a machine containing personal credentials. The Cloudflare alternative is a separate commented job that rebuilds with a root base.

## Data provenance

Natural Earth ADM0 is public domain; geoBoundaries gbOpen ADM1 is CC-BY 4.0; OSM tiles are ODbL; Protomaps supplies basemap/style assets. See [full attribution](docs/ATTRIBUTION.md). Boundary fixtures and upstream URLs/checksums are committed; missing non-fixture boundaries download from pinned sources, but geocoding never happens in a build. New label glyph ranges are vendored from a pinned Protomaps asset commit. Fixture verification forbids both kinds of downloads.

Nominatim is used only by the explicit cache command, with a descriptive contact-bearing User-Agent, a minimum 1.1 seconds between requests, country filtering and ambiguity failure. Read its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) before refreshing a large configuration.
