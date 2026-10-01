# Guide

Running, exploring, recording, choosing a basemap, verifying and deploying Atlas of a Life. The [README](../README.md) is the overview; [data authoring](DATA.md) covers `data/visits.ts`.

## Run locally

Requires Node 22.12+ and npm.

```sh
npm ci
npm run dev        # generate, then serve with hot reload
npm run build      # generate and build dist/
npm run preview    # serve dist/
```

The first generation installs the committed 22 MB preview tile archive if no local archive exists. It has global z0–3 and six small city windows through z14: enough for the app and verification, not the complete bundled basemap. Use `VITE_BASE=/some/subpath/ npm run build` for a subpath; the default base is relative. `npm run analyze` writes `dist/bundle-analysis.html`.

## Explore the atlas

The atlas opens in your system's light or dark appearance; the sun/moon button beside the zoom controls switches between **day** and **night** and remembers the choice. `?theme=light` or `?theme=dark` pins one for a link. The globe stays north-up: drag or use the arrow keys to pan, scroll, pinch, the on-screen **+**/**−** buttons or the `+`/`−` keys to zoom. **World** (or **Alt+W**, Option+W on macOS) restores the overview without changing the timeline. Search folds accents, so `odsmal` finds Ödsmål. Country names and dates follow the browser language; `?deterministic=1` pins British English.

Country names appear as you leave the world view and give way to region names, then to place names; hovering a country or region highlights its outline when it is the current click target. The count line under the title opens **By the numbers**: totals, how much of the world and of each continent the atlas covers, milestones (the furthest point from home, the crow-flies distance, the extremes of the compass, the longest journey, the longest time between trips), nights by year, two years side by side, and places by country with regions covered. Every place named in a milestone is a link that lights it on the map. **Tour** flies from the current view into the recorder's 24-second choreography; any drag, Escape, World or a selection stops it, and reduced motion holds each shot instead of flying.

**Places** opens the directory. **In view** follows the visible map area; **All places** includes off-screen destinations. Both respect the timeline. Search cities, regions or countries and page through places in first-visit order. On a phone the directory is a bottom sheet that rides above the keyboard, and a tap selects the nearest place, journey stop or home within a thumb's reach.

Consecutive visits form **journeys**. No lines are drawn in the normal view. Selecting a stop, hovering a journey in the directory, or choosing it from the directory's **Journeys** scope puts it in focus: dotted arcs and numbered stops appear in travel order and everything else recedes. The arcs are deliberately curved: "from here to there", never the road taken. The caption names the journey, shows an itinerary strip whose segments are as wide as the nights stayed, and steps to the previous or next stop (also **←**/**→** while the caption has focus). A **day trip** (a single day out from a stay, back by evening) is not a stop: it hangs off its base as a lens of fine dots with a small hollow ring, appears once you are close enough for the two to come apart, sits above its stop's segment in the strip, and the caption reads "Day trip from …" or "Day trip to …". A place only ever seen on day trips is a hollow pin. **Home** is a hollow ring rather than a pin; it lights its region and counts as a place, journeys leave from it and return to it along fainter legs, and clicking the ring or choosing it in the directory opens a short home caption. **Escape** or a click on empty map lets a journey go, closes the caption or directory, and restores keyboard focus.

The timeline has one tick per visit date and a final **All visits** position. **Through** means "first visited by this date"; **During** lights only visits under way in that month. Undated visits stay lit throughout. The address bar follows what you see: a selected place (`#/place/<id>`), a camera you moved (`#/view/…`) and the timeline (`?through=…&mode=only`), so any view can be shared.

## Add a place

Add an entry to `data/visits.ts` with only the fields you have:

```ts
{ country: "GR", city: "Kalamos", dateRange: ["2025-04-27", "2025-05-02"] }
```

Or let the command do it:

```sh
NOMINATIM_CONTACT=you@example.org npm run add -- GR Kalamos 2025-04-27..2025-05-02
npm run add -- DE Potsdam 2025-03-01 --day-trip
npm run import -- file.csv
```

Both validate, append, geocode and print the resolved point. A single date inside a stay is a day trip from that stay on its own; `--day-trip` is for a day out from home or on a stay's first or last day. If you edit by hand, run `NOMINATIM_CONTACT=you@example.org npm run geocode` for new cities, then `npm run build`. Commit the config, the geocache and `data/sources.json`. Set your home once with `home: { country: "DE", city: "Berlin", since: "2024-04-25" }`; journeys start and end there. See [data authoring](DATA.md) for identity, precision, home, journeys and day trips.

## Record a tour

Install FFmpeg with `ffprobe` and `libx264` (macOS: `brew install ffmpeg`) and Chromium (`npx playwright install chromium`), then:

```sh
npm run record
npm run record -- --format portrait --place Berlin --out recordings/berlin-tour
npm run record -- --help
```

The default renders portrait 1080×1920, square 1080×1080 and landscape 1920×1080 into a UTC-stamped directory under `recordings/`: silent H.264 MP4, 24 seconds, 720 frames at 30 fps, with a full-resolution poster PNG each. The camera establishes the globe, settles over the anchor's region at zoom 4.75–5, pulls back, reveals a second region and ends on a calm pullback; every moving frame is rendered, so recording takes longer than playback. `--format` accepts `all`, `portrait`, `square` or `landscape`; `--place` takes a public ID or a unique label and sets the first regional focus; `--out` must not exist yet. Recording builds once with `VITE_BASE=/atlas/` and serves it on port 4180, so do not run verification at the same time. It needs global tiles through z6, which the preview archive does not have: build the full basemap first.

## Install and offline

The site ships a web manifest and icons, so it can be installed from the browser menu. A build-generated service worker precaches the shell (page, scripts, styles, fonts, sprites, glyphs) and serves it when the network is gone. With a bundled archive, open the map credits and choose **Save the map for offline use** to keep the tile archive in the browser; **Remove** deletes it. `?deterministic=1` skips registration, so verification stays pure.

## Privacy

Publication precision defaults to `city`: even an authored street coordinate is replaced by the city's coordinates unless the visit sets `publishPrecision: 'exact'`. Source addresses, precision flags and cache provenance never enter the build output. The build protects `dist/`, not Git history: do not commit private addresses to a public repository.

## Basemap deployment

### Remote archive

Set `VITE_BASEMAP=remote`, `VITE_BASEMAP_URL` to your archive URL and `VITE_TILE_ORIGINS` to any redirect origins the hosting probe reports. Remote mode refuses a missing URL, a mutable Hugging Face revision or a dated planet-build URL. The recommended host is a Hugging Face dataset resolve URL pinned to a commit SHA. Before deploying, run:

```sh
npm run verify:hosting -- URL --origin https://your-site.example --min-zoom 0 --max-zoom 14 --bounds -180,-85.0511287,180,85.0511287
```

The probe requires exact byte-range answers, exposed `Content-Range`, CORS from your origin, vector Protomaps layers, z0–14 and global bounds, measured from a real Chromium page. For a country-only archive without city detail, pass `--max-zoom 6`.

`npm run tiles:publish -- --help` describes publishing with the `hf` CLI: it uploads the archive and an OSM-derived dataset card to your own dataset, verifies the remote bytes and writes the immutable resolve URL into `.env.production`. It never uploads `data/visits.ts`.

### Bundled archive

Install [`pmtiles`](https://docs.protomaps.com/pmtiles/cli) and `tile-join` from [Tippecanoe](https://github.com/felt/tippecanoe) (`brew install tippecanoe` on macOS), then:

```sh
npm run generate
npm run basemap:build -- https://build.protomaps.com/20260914.pmtiles src/generated/places.json /tmp/new-basemap.pmtiles
mv /tmp/new-basemap.pmtiles public/tiles/basemap.pmtiles
VITE_BASEMAP=bundled npm run build
```

Find a current source at [Protomaps builds](https://maps.protomaps.com/builds); dated URLs expire. The script extracts global z0–6 plus z7–14 within 20 km of each city (`CITY_PADDING_KM` changes the radius), merges overlapping tiles, verifies the archive and warns above 250 MB. A full extract is about 212 MB and is ignored by Git. The output path must not exist yet. The same archive can be bundled or hosted remotely; only its URL changes.

## Verification

```sh
npm run verify -- --quick      # the CI gate: lint, types, unit, fixture build, style, payload, budgets
npm run verify                 # full run: runtime, a11y, performance, visual diffs; local, needs a GPU
npm run verify:approve         # write visual baselines, only for an intended pixel change
npm run verify -- --set-baseline
```

Quick mode runs in under a minute on hosted Linux and gates deployment. Full mode serves the fixture under `/atlas/`, uses pinned Chromium, DPR and viewport, traces real camera choreographies, audits network origins, tests keyboard paths and reduced motion, runs axe and compares six exact PNGs. It needs real GPU acceleration; software renderers fail the performance gates on purpose. It never runs in CI: run it locally before merging a change that touches rendering, motion or pixels, and commit the approved baselines. `verification/report.json` holds every measured gate, threshold and delta; diff images go to `verification/artifacts/`. Missing output or baselines fail. Only `verify:approve` writes baselines.

Fixture verification (`ATLAS_FIXTURE=1`) uses fictional visits and committed boundaries and forbids every download.

## Deployment

The workflow runs quick verification on every push and pull request, comments the objective table on same-repository pull requests, and deploys `main` to GitHub Pages. Set repository variables `VITE_BASEMAP_URL` and `VITE_TILE_ORIGINS`; the deploy job fails without the URL. `VITE_SITE_URL` is derived from the Pages URL so Open Graph tags are absolute; `npm run social` renders the 1200×630 card they reference. A Cloudflare Pages job is commented alongside.

The build injects a strict CSP: scripts, fonts and styles from self, only explicit tile origins for connections, blob workers for MapLibre, no inline script except the hashed theme boot. Deploy over HTTP(S), not `file://`. `_headers` gives hashed assets a one-year immutable policy and marks `sw.js` no-cache on hosts that honour it; GitHub Pages does not, so use an immutable remote archive there. Never gzip a PMTiles object at the CDN.

## Data provenance

Natural Earth is public domain; geoBoundaries gbOpen is CC-BY 4.0; OSM tiles are ODbL; Protomaps supplies basemap and style assets. See [attribution](ATTRIBUTION.md). Boundary sources are pinned by URL and SHA-256 in `data/sources.json`; missing non-fixture boundaries download from those sources at build, but geocoding never happens in a build. Nominatim is used only by the explicit commands, with a contact-bearing User-Agent and at least 1.1 s between requests; read its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) before refreshing a large configuration.
