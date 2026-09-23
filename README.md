# Atlas of a Life

A quiet, static night-sky atlas of places visited. Globe → countries → regions → places is one continuous MapLibre zoom, not three screens. Author city, country and optional dates; coordinates, display labels, IDs and boundary membership are discovered or generated. Code is MIT; geographic data keeps its upstream licences.

## Run locally

Requires Node 22.12+ and npm. Run `npm ci`, then `npm run dev` for cached visits. After adding cities, run the explicit geocode step below first. The first generation installs the committed 22.3 MB preview tile archive if no local archive exists. It has global z0–3 and six small city windows through z14; it is a deterministic demonstration, **not** the complete bundled basemap. Verification uses separate fictional visits and public landmark fixtures; the owner configuration is independent.

`npm run build` produces `dist/`; `npm run preview` serves it. Use `VITE_BASE=/some/subpath/ npm run build` for a subpath, or retain the default relative `./` base. `npm run geocode` is the explicit cache-warming step. `npm test` runs the same unit contracts used by verification. `npm run analyze` generates `dist/bundle-analysis.html`.

GitHub Pages deployment discovers its actual site base with `actions/configure-pages` **before** building. Custom domains such as `https://atlas.brnnnsthl.eu/` use `/`; project sites use their configured `/repository/` path. Do not derive the base from the repository name alone. For a manual root-domain build, run `VITE_BASE=/ npm run build`. Changing the deployment base requires rebuilding and redeploying; it does not repair an already-published HTML file.

## Record a cinematic globe and region tour

Install FFmpeg with `ffprobe` and `libx264` (macOS: `brew install ffmpeg`) and Chromium with `npx playwright install chromium`, then run:

```sh
npm run record
npm run record -- --format portrait --place Berlin --out recordings/berlin-tour
npm run record -- --help
```

The default command independently renders portrait **1080×1920**, square **1080×1080** and landscape **1920×1080** movies into a unique UTC-stamped directory under `recordings/`. Each silent H.264/yuv420p MP4 is **24 seconds / 720 frames / 30 fps**, with BT.709 tags and fast-start playback, accompanied by a full-resolution regional `<format>-poster.png`. Lossless browser PNGs feed the encoder directly; every moving frame is rendered, so offline capture takes longer than playback. The real responsive controls, all-years timeline, typography and attribution remain intact. Music, editorial captions and publishing are separate.

The camera establishes the globe, settles over the anchor's region, zooms in and holds, pulls back for a broad transfer, reveals a second region, then ends with a calm pullback. **Regional zoom reaches 4.75–5**, making the app's real regional fills and boundaries visible without street-level dives or place dialogs. Quintic minimum-jerk easing settles both velocity and acceleration at shot boundaries. Panning and zooming happen separately: regional zooms keep their centers locked, and travel happens at zoom 2.25. There is no oscillating waypoint path or forced reverse sweep to make a loop. Existing gold city pins remain visible, and representative names use fixed text anchors rather than hopping sides as the map moves. All capture-layer adjustments stay inside the recording browser; production application styles are unchanged.

`--format` accepts `all` (default), `portrait`, `square` or `landscape`. `--place` accepts an exact public ID, otherwise a unique case-insensitive exact display label, and sets the first **regional focus**, not a city close-up. Without it, the first freshly generated public place anchors the tour. Up to four geographically varied entries provide readable labels; the most distant representative supplies the second regional focus. `--out` must name a directory that does **not** exist, even if empty. Help and invalid flags do not build or launch the browser. Failures and Ctrl-C remove unfinished `.partial.mp4` files and preserve completed outputs.

Recording runs the ordinary build once with `VITE_BASE=/atlas/`, using the current public data, privacy rules and configured basemap. It serves `dist/` on dedicated port **4180**; do not run another build/verification concurrently. It does not substitute fixture data, change precision or switch basemaps. Regional reveals require complete global overview/regional tiles through z6, as supplied by the normal basemap workflow; they do not need city/street extract coverage. The committed z0–3 preview archive alone is not sufficient for this deeper tour.

## Explore the atlas

The globe stays north-up: drag or use the arrow keys to pan, scroll/pinch or use `+`/`−` to zoom. **World** (or **Alt+W**, Option+W on macOS) restores the overview without changing the year. The shortcut does not fire while editing a field.

**Places** opens a compact directory. **In view** follows the visible map area, excluding the far side of the globe; **All places** also includes off-screen destinations. Both respect the year filter. Search cities, regions or countries, and page through six places at a time in first-visit order. Selecting a place closes the directory and opens its caption. **Escape** closes the caption or directory and restores keyboard focus.

The small year slider means “visited by this year”; its reset restores all years. Undated visits remain available throughout.

## Add a place

Add an entry to `data/visits.ts` with only the fields you have:

```ts
{ country: "GR", city: "Kalamos", dateRange: ["2025-04-27", "2025-05-02"] }
```

Use uppercase country codes (`DE`, `GR`, `GB`) and `YYYY-MM-DD` dates. A single-day visit uses `date` instead of `dateRange`. IDs and city labels are generated automatically; tags are not supported.

Run `NOMINATIM_CONTACT=you@example.org npm run geocode` for new cities, using your own contact email or URL, then `npm run build`. Commit the config and updated geocache/source manifest, then redeploy `dist/`. No region codes or coordinates need to be authored. Same-named cities can require an optional qualifier rather than a guessed location. See [data authoring](docs/DATA.md) for identity stability, precision and boundary-provider limitations.

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
