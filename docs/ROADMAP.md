# Roadmap: implementing the September 2026 review

This plan turns the review findings into ten sequenced releases. Each release is one pull request, ends green under `npm run verify -- --quick`, and gets a full GPU verification plus, where it changes pixels, an explicit `npm run verify:approve` on the Mac runner. Every release adds an entry to `docs/EVOLUTION.md` with measured numbers and, where it decides something, a paragraph in `docs/DECISIONS.md`.

## Ground rules carried from the decisions log

- **Publication allowlist stays closed.** Anything new that ships to the browser is either derived from the existing public fields (id, label, country, region, city, coordinates, dates, visitCount) or is an explicitly documented new public field. `verification/payload.ts` is extended for every new generated file, never bypassed.
- **One accent.** Lamplight `#efc784` remains the only warm colour. New layers (labels, routes, ticks) use it or the greys.
- **No photos, names, notes, tags.** Trips and statistics are computed from dates and geography only.
- **Stationary camera after ignition.** Nothing moves the camera without a user action, except the opt-in tour.
- **Baselines are approved, not regenerated.** Releases that change pixels say so up front.

## Sequencing and dependencies

| # | Release | Depends on | Changes pixels | Size |
|---|---------|-----------|----------------|------|
| 0 | Housekeeping and a real CI gate | – | no | S |
| 1 | Small UX release | 0 | yes (chrome) | M |
| 2 | Readable middle band: labels and hover | 0 | yes | M |
| 3 | Progressive geometry | 0 | no (same geometry, later arrival) | M |
| 4 | Time and URL state | 1 | yes (timeline) | L |
| 5 | Journeys | 4 | yes | L |
| 6 | In-app tour | 5 (nice), 3 | no (opt-in) | M |
| 7 | By the numbers | 4 | yes (header) | M |
| 8 | Authoring tools | – | no | M |
| 9 | Installable and offline | 3 | no | L |

Releases 2, 3 and 8 are independent of each other and can run in parallel branches. 4 must precede 5 because trip visibility reuses the time predicate. 6 wants 3 so the tour's regional shots have fine geometry loaded early.

---

## Release 0: housekeeping and a real CI gate

**Goal.** Make the repository say true things and make every later PR gated by the checks that can run on hosted Linux.

**Steps.**

1. `git rm --cached data/visits_backup.ts`. The file is ignored by `.gitignore` but tracked, and its `tags` field is rejected by the strict schema.
2. In `.github/workflows/deploy.yml`, add a `quick` job on `ubuntu-latest`: checkout, setup-node 22 with npm cache, `npm ci`, `npm run verify -- --quick`, upload `verification/report.json` as an artifact, run `node scripts/objective-summary.mjs` into the step summary. Trigger on push and pull_request. Set `deploy: needs: quick`.
3. Keep the GPU `verify` job commented but rename its comment header to make clear it is the optional full run for the self-hosted runner, and reactivate the PR `comment` job against the `quick` artifact so PRs get the objective table again.
4. README: rewrite the CI paragraph ("builds and deploys after full verification" becomes "after quick verification on hosted Linux; full GPU verification runs on the self-hosted runner when available"). Replace the fixed geometry/JS numbers with a pointer to `verification/report.json` and the current owner build figure (615 KB gzip geometry, above the 400 KB target, to be addressed in Release 3).
5. Confirm `verify --quick` uses `ATLAS_FIXTURE=1` end to end (it runs the fixture build; check `verification/run.ts` line 24 onward) so the hosted job never needs Nominatim or boundary downloads.

**Acceptance.** A PR to main shows a required `quick` check and an objective table comment. `git ls-files data/visits_backup.ts` prints nothing.

---

## Release 1: small UX release

Seven independent fixes, one PR, one baseline approval.

### 1a. Caption geography without duplication

- Extract `captionGeography(place, regionLabels, countryName)` into `src/map/caption.ts`. It returns the region only when `regionLabel.localeCompare(place.label, undefined, { sensitivity: "base" }) !== 0`.
- Use it in `src/main.tsx` where `place-geography` is rendered.
- Unit test in `verification/contracts.test.ts`: Berlin/DE-BE yields "Germany" only; Kalamos/Attica yields "Attica / Greece".
- Check `interaction.pin-caption` in `verification/runtime.ts`: it asserts the label is present, not the region, so it keeps passing.

### 1b. Diacritic-insensitive search

- Create `src/map/text.ts` with `fold(value)`: NFKD, strip `\p{Mark}`, lowercase, collapse whitespace. Move the slug normalisation in `scripts/config.ts` to call it so authoring and search share one rule.
- Apply `fold` to `searchText` construction and to the query in `results` in `src/main.tsx`.
- Tests: "odsmal" finds Ödsmål, "hoor" finds Höör, "lubbenau" finds Lübbenau, "swinemunde" finds Swinemünde, and "ödsmål" still matches. Add a fast-check property: `fold(fold(x)) === fold(x)`.

### 1c. Page identity: title, favicon, social card

- `document.title` effect in `App`: `"<label> · Atlas of a Life"` when a place is selected, otherwise the bare title. Restore on dismiss.
- `public/favicon.svg`: a lamplight dot on midnight. Replace `href="data:,"` in `index.html`. `img-src 'self'` already permits it.
- Open Graph and Twitter meta in `index.html`: title, description, `og:image` at `%BASE_URL%social/card.png`, `og:url`. Absolute URLs are required, so add `VITE_SITE_URL` to the build; in the workflow derive it from `steps.pages.outputs.base_url`. Vite's `%VITE_SITE_URL%` HTML env replacement handles the substitution; fall back to a relative URL locally.
- Card image: add `scripts/build-social.ts` that reuses the verification browser helpers to capture a deterministic 1200×630 view of the globe and writes `public/social/card.png`. Commit the image; the script is run by hand like the recorder, not in the build, so hosted CI needs no Chromium.

### 1d. Focus restoration on map-click dismiss

- In `src/main.tsx`, the `onSelect` callback passed to `createMap` currently only clears state when `id` is null. Make it call `restoreFocus()` when a place was previously selected. `route()` also calls `onSelect(null)` on hashchange; focusing the canvas in that case is acceptable.
- Runtime check: extend the keyboard scenario near `runtime.ts` line 543 to click empty ocean and assert `document.activeElement` is the browse button or the canvas.

### 1e. Narrow-screen directory

- Default scope: `useState<"view" | "all">(matchMedia("(max-width: 700px)").matches ? "all" : "view")`.
- In `app.css` under the 700 px query, cap `.place-explorer` at `max-height: 52svh` so the globe stays visible above it, and move the hint into the heading row to reclaim a line.
- Mobile axe check in `runtime.ts` already opens the directory; it keeps passing. Visual baselines do not include the open mobile directory, so no approval is needed for this item alone.

### 1f. On-screen zoom controls

- Add `+` and `−` buttons inside `.navigation` next to World, wired to `map.zoomIn()` / `map.zoomOut()` with the shared easing and `animate: !media.matches`. Expose `zoomBy(delta)` on the `Atlas` type in `src/map/create-map.ts`.
- `aria-label="Zoom in"` / `"Zoom out"`, `aria-keyshortcuts="+"` / `"-"`. Hide the `kbd` hints under 700 px as the World button does.
- This changes every screenshot; approve baselines once for the whole release.

### 1g. Locale-aware names and dates

- Build `locale` once: `deterministic ? "en-GB" : navigator.language`. Pass to `Intl.DisplayNames`, `Intl.DateTimeFormat` and the search text. The `?deterministic=1` guard keeps verification stable.
- Region labels come from the boundary provider and stay as shipped.

**Acceptance for Release 1.** Contracts tests cover 1a, 1b, 1g. Quick verification green. Full verification green after one baseline approval. Sharing a place URL in a chat client shows title, description and card.

---

## Release 2: readable middle band

**Goal.** Country and region names appear at the zoom band where their fills are the subject, and fills feel clickable.

**Steps.**

1. **Anchor source.** In `scripts/build-geo.ts`, emit `anchors.geojson`: one Point per published country and region at `properties.anchor` (already computed by `geometryMetadata` in `scripts/boundaries.ts`) with `{ id, kind: "country" | "region", label }`. Add it to the geometry byte report but exclude it from the LOD total since it is tiny.
2. **Style layers.** In `scripts/build-style.ts`, add source `anchors` with `promoteId: "id"` and two symbol layers:
   - `country-labels`: filter `kind == country`, Noto Sans Regular, size 11 to 13, `text-opacity` = `withVisibility(bands.country)` scaled so labels fade in at zoom 2.25 and out by 4.5.
   - `region-labels`: filter `kind == region`, opacity from `withVisibility(bands.region)`, visible 4.25 to 7, fading as pins and place labels arrive.
   - `text-color` mist `#a7b2bf`, halo midnight width 2, `text-allow-overlap: false`, `symbol-sort-key` favouring countries.
3. **Glyphs.** The build vendors glyph ranges only for place labels (`build-style.ts` around line 278). Extend the `ranges` set with anchor labels. Run a non-fixture build once to download any new `.pbf` ranges and commit them; fixture builds forbid downloads.
4. **Feature state.** In `src/map/create-map.ts`, extend the `features` array with `anchors` entries so `filter()` and `motionChanged()` drive label visibility with the same year filter as fills. Key visits by country for country anchors and by region for region anchors.
5. **Hover and cursor.** Extract `activeLayer(zoom)` returning `"pins" | "regions" | "countries"` from the click handler and unit test the thresholds (3.5, 6.5). Add `mousemove`/`mouseleave` handlers on `countries` and `regions` that set `cursor: pointer` and a `hover` feature state only when that layer is the active one. Bump `country-outline` and `region-outline` opacity on hover through a `case` on `feature-state hover`, mirroring `pin-halos`.
6. **Region labels JSON.** `src/generated/region-labels.json` can now be derived from `anchors.geojson`; keep the file for the caption but generate it from the same source of truth.

**Verification.** Contracts test that `anchors.geojson` has exactly one feature per published country and region and that each anchor lies inside its polygon's bbox. `verification/style.ts` layer-count and continuity checks need the new layer IDs. Frame p95 budget (24 ms) must hold with two extra symbol layers; if it does not, drop `country-labels` first since country names are on the basemap already. Baseline approval required.

---

## Release 3: progressive geometry

**Goal.** Get the owner build back under the 400 KB gzip geometry target on first view and let the globe paint before fine boundaries arrive, without changing what is eventually drawn.

**Current state.** `build-geo.ts` writes four LODs; `build-style.ts` embeds coarse countries and **fine** regions inline in `style.json` (960 KB raw, 320 KB gzip), which `createMap` fetches in full before constructing the map. `countries-fine.geojson` and coarse `regions.geojson` are written and never read.

**Steps.**

1. **Inline coarse only.** In `build-style.ts`, embed `countries.geojson` (coarse) and `regions.geojson` (coarse) as source data. Keep `promoteId` so feature IDs are stable across LODs.
2. **Emit fine LODs as assets.** Import `../generated/countries-fine.geojson?url` and `../generated/regions-fine.geojson?url` in `create-map.ts` so Vite hashes and serves them separately with immutable caching from `_headers`.
3. **Swap on demand.** After `load`, when zoom first exceeds 3.0, fetch `regions-fine` and call `map.getSource("regions").setData(...)`; when zoom first exceeds 4.5, do the same for countries. Fetch each once, keep an `AbortController` tied to `destroy()`. Feature state is keyed by promoted ID, so `states` re-application after `setData` is a safety net: re-apply `visibility` from the `states` map on `sourcedata` for that source.
4. **Fixture guard.** The verification server serves `dist/` so the hashed assets exist; deterministic mode should trigger the swap eagerly on load so screenshots keep comparing fine geometry.
5. **Budgets.** Split `geometryGzip` into `geometryInlineGzip` (target 120 KB) and `geometryTotalGzip` (unchanged 400 KB target, 1 MB hard cap) in `verification/budgets.json`, `verification/payload.ts` and `build-geo.ts` reporting. Re-measure `firstViewBytes` and `firstViewRequests` (two more requests when the user zooms, zero at first view).
6. **Docs.** Update README figures and add a DECISIONS paragraph on the two-stage LOD.

**Acceptance.** Cold first-view transferred bytes drop by roughly 250 KB gzip on the owner build; visual diff against the approved baselines stays at 0 pixels because the deterministic path loads fine geometry before capture.

---

## Release 4: time and URL state

The largest release. It replaces the year slider, adds nights, makes views linkable and shortens IDs. Ship in the order below inside one PR, or split 4a/4b from 4c/4d if review size matters.

### 4a. Time predicate

- Create `src/map/time.ts` with `visibleAt(visit, through: string, mode: "cumulative" | "only"): number` returning 0 to 1. Cumulative: 1 when `dateBounds(visit)[0] <= through`. Only: 1 when the visit's range intersects the month of `through`. Undated always 1. Keep the half-step fade currently in `filter()` for cumulative so the animation is unchanged.
- Move `dateBounds` from `scripts/config.ts` into `src/map/time.ts` and re-export it from config so both sides share it.
- Tests: fast-check properties (monotonic in `through` for cumulative; undated invariant; open ranges).

### 4b. Ordinal scrubber

- Build `chronology` positions at module level in `src/main.tsx`: sorted distinct first-visit dates. The slider is `min=0 max=N-1`, label shows `Intl.DateTimeFormat(locale, { month: "short", year: "numeric" })` of the selected date, last position reads "All visits".
- Tick marks: absolutely positioned 2 px spans over the track, one per position, mist colour, active ticks lamplight. Keep the 44 px hit target.
- Mode toggle: a two-segment control "Through" / "During" next to the label, hidden under 700 px behind a long-press or omitted on mobile in the first cut. Persist choice in the URL (4c), not localStorage.
- Replace `Atlas.filter(year)` with `filter(through: string, mode)` in `create-map.ts`, computing `target` with `visibleAt`. The explorer's `eligiblePlaces` uses the same predicate.
- `aria-label` becomes "Visited through" and `aria-valuetext` the formatted month. Update `interaction.timeline` in `runtime.ts`: select the slider by its new name, move to the position just before London's fixture date, and keep the red-channel pixel assertion.
- Caption: add nights. `nights(visit)` in `time.ts` = whole days between range endpoints, omitted for single days and open ranges. Render "6 nights" beside the dates.

### 4c. Shareable view state

- Create `src/map/router.ts` with pure `parseHash(hash): Route` and `formatHash(route)`. Routes: `#/place/<id>`, `#/view/<zoom>/<lat>/<lng>`, and a `?through=YYYY-MM&mode=only` query on either. Round-trip property tests.
- In `create-map.ts`, write `#/view/...` with `history.replaceState` on `moveend` only when `stopped` is true (a user moved the camera) and no place is selected; throttle to one write per 250 ms. Never write during ignition or the tour.
- On load, a `#/view` hash suppresses ignition exactly like `#/place` does today and `jumpTo`s the camera. `?through` initialises the scrubber before `filter()` runs.
- Deterministic and verification runs pass no hash, so approved screenshots are unaffected.

### 4d. Short public IDs

- In `scripts/config.ts` change the generated ID to `${country}-${slug}-${digest.slice(0, 8)}`; the existing `used`/`occurrences` loop already resolves collisions.
- Backward compatibility: in `route()`, when a hash ID is not found, accept any place whose ID is a prefix of the requested ID (the new ID is a prefix of the old one). Replace the URL with the canonical short form, as the alias path already does.
- Update `verification/fixtures/manifest.json` and any expected IDs in contracts tests; document in `docs/DATA.md` that existing links keep working.

**Acceptance for Release 4.** The Scandinavian summer can be isolated with the scrubber; "During Jun 2025" shows only Denmark, Norway and Sweden stops. A `#/view` link reproduces a region view and filter on another machine. Old place links resolve. Baseline approval for the new timeline chrome.

---

## Release 5: journeys

**Goal.** Show the routes the data already contains, with previous/next navigation.

### 5a. Trip inference at build

- `scripts/trips.ts`: `inferTrips(visits)` sorts dated city visits by start, then chains a visit onto the current trip when its start is within one day of the previous end (contiguous or overlapping). A trip needs two or more stops. Boundary-only visits and undated visits never join.
- Optional authored field `trip?: string` in `visitSchema` (strict object, so the schema must grow): visits sharing a `trip` string are grouped regardless of gaps, and the string becomes the public label. Document in `docs/DATA.md` that this label is public.
- Generated label when not authored: countries in stop order joined with an Oxford-free list plus the year, for example "Denmark, Norway and Sweden, 2025". Uses `Intl.DisplayNames("en")` at build.
- Emit `src/generated/trips.json`: `[{ id, label, start, end, stops: [placeId] }]`. Trip IDs follow the same slug-plus-digest scheme.
- Emit `routes.geojson`: one LineString per trip through stop coordinates, densified every 100 km along the great circle so globe rendering follows the sphere. `properties: { trip }`, `id: trip`.
- Extend `verification/payload.ts` with allowlists for trips (`id,label,start,end,stops`) and audit `trips.json` and the route geometry coordinates against the same precision-safe expectations as pins.
- Tests: contiguity, overlap, one-day gap joins, two-day gap splits, authored label wins, single visits excluded, densify monotonic distance, dateline crossing.

### 5b. Route layer

- `build-style.ts`: source `routes` (`promoteId: "trip"`), layer `routes` type line, lamplight, width 0.8 to 1.2 by zoom, opacity band starting at 3.5 and multiplied by feature-state visibility. Draw beneath pins, above region fills.
- `create-map.ts`: add trips to `features` so the time filter drives them; a trip's visibility is the max visibility of its stops so it appears as its first stop lights.

### 5c. Caption navigation

- Build `tripByPlace` and a global `chronology` index at module scope in `src/main.tsx`.
- Caption gains a line "Part of <trip label> · stop 3 of 8" when applicable, and two buttons "Previous" / "Next" that call `atlas.select` on the neighbouring stop. Outside a trip, the buttons step through global chronology and the line reads "Visit 5 of 18".
- Keyboard: ArrowLeft/ArrowRight while the caption has focus, exposed with `aria-keyshortcuts`. Do not bind globally; arrows pan the map.
- Explorer: a third scope "Journeys" listing trips with date span and stop count; selecting one flies to the bounds of all stops with `maxZoom` 6 and opens nothing.

**Verification.** Contracts for 5a; a runtime scenario that selects a fixture stop and presses Next, asserting the dialog label changes; axe on the caption with buttons. Baseline approval for the route line and caption.

---

## Release 6: in-app tour

**Goal.** A "Tour" button that plays the recorder's globe-and-regions choreography in the browser.

**Steps.**

1. Move the pure functions `selectTourStops`, `createGlobeTour`, `cameraAtFrame` and their types from `scripts/recording.ts` into `src/map/tour.ts`. Re-export them from `scripts/recording.ts` so the 20 recording tests and the recorder keep working unchanged.
2. Add `play()` and `stop()` to `Atlas`. `play()` builds the tour from `places` with the first published place as anchor and the canvas size as viewport, then runs a `requestAnimationFrame` loop mapping elapsed time to `frame = elapsed * 30` and calling `map.jumpTo(cameraAtFrame(frame, tour))`. It ends after 720 frames on the overview camera and sets `stopped = true`.
3. Any user `movestart` with `originalEvent`, Escape, the World button, a place selection, or a scrubber change stops the tour. The Tour button toggles to "Stop".
4. Reduced motion: replace the continuous flight with a stepwise version that `jumpTo`s each keyframe with a 1.5 s hold, or disable the button with a title explaining why. Prefer stepwise.
5. Release 3's fine LOD swap should trigger at tour start so regional shots are sharp.
6. Verification: a correctness scenario starts the tour, waits 500 ms, drags the map, and asserts the camera stops moving within one frame. Measure p95 frame time during a 5 s tour slice and record it in the report as informational before deciding whether to gate on it.

---

## Release 7: by the numbers

**Goal.** A small statistics panel that opens from the header count line.

**Steps.**

1. `scripts/stats.ts` computes at build from public visits and trips: countries, regions, places, visits, nights total and per year, longest stay (place label, nights), first-visit year per country, places per country, trips count. Emit `src/generated/stats.json`, audit it in `payload.ts` (no coordinates allowed).
2. Turn `.atlas-count` into a button with `aria-expanded` that opens a panel styled like the explorer, positioned under the header. Escape closes it and returns focus. Only one of explorer, caption and stats is open at a time.
3. Content: a definition-list of totals, a per-year row of nights rendered as text plus a proportional lamplight bar (single accent, mist track, `aria-hidden` bar with the number in text). Load the `dataviz` skill before designing the bar row.
4. Runtime: axe on the open panel, keyboard open/close, and a contracts test that stats match a recomputation from the fixture.

---

## Release 8: authoring tools

**Goal.** Adding a visit becomes one command.

### 8a. `npm run add`

- `scripts/add.ts` with usage `npm run add -- DE Berlin 2024-04-25` or `DE "Wendisch Rietz" 2025-04-04..2025-04-06`, optional `--region`, `--label`, `--trip`, `--dry-run`.
- Validate the candidate with `visitSchema` before touching files. Detect an existing identical country/city/date and refuse.
- Insert into `data/visits.ts` using the `typescript` compiler API already in devDependencies: parse, find the `visits` array literal, insert a formatted object before the closing bracket, print with the existing formatting (two-space indent, trailing commas). Never rewrite unrelated lines.
- Run `geocodeConfig` from `scripts/geocode.ts` for the config so the new city is cached (requires `NOMINATIM_CONTACT`, reuses the 1.1 s throttle), then print the resolved coordinates and remind to run `npm run build` and commit `data/geocache.json` and `data/sources.json`.
- Tests: argument parsing, date range parsing, AST insertion round-trips a fixture file byte-for-byte except the new entry, duplicate refusal.

### 8b. `npm run import`

- CSV with header `country,city,start,end,label,trip`; each row goes through the same path as 8a; a summary lists inserted, skipped duplicates and validation failures with row numbers. Geocode once at the end for all new cities.
- GPX or Google Timeline import needs reverse geocoding of many points against Nominatim's usage policy. Mark as stretch: implement only with an explicit `--reverse` flag, a hard cap of one request per 1.1 s and a per-run limit, and document the policy link.

---

## Release 9: installable and offline

**Goal.** Home-screen install and an offline-capable shell, with an opt-in full-archive download in bundled mode.

### 9a. Shell

- `public/manifest.webmanifest`: name, short name, `start_url` relative, `display: standalone`, `theme_color`/`background_color` `#080f18`, icons 192 and 512 PNG generated from `favicon.svg` by a small script and committed.
- Service worker generated by a Vite plugin `atlas-sw` in `vite.config.ts` at `closeBundle`: precache the hashed JS/CSS/style JSON/generated GeoJSON, fonts, sprites and the glyph ranges present in `dist`; cache-first for those, network-only for PMTiles. Register from `main.tsx` only in production builds and only when `navigator.serviceWorker` exists.
- `_headers`: `sw.js` gets `Cache-Control: no-cache`. GitHub Pages ignores headers, so the worker is served with a short TTL by naming it with a build hash in the registration URL query.
- CSP already allows `worker-src 'self'`. The origins audit in verification must see no new origins.

### 9b. Opt-in archive for bundled mode

- A "Save for offline" control in the attribution details, shown only when `VITE_BASEMAP=bundled`. It downloads the archive with progress into the Cache API as a single response.
- The worker answers Range requests for the archive URL by slicing the cached body and returning 206 with `Content-Range`, which is what the PMTiles protocol expects. Guard with a size check and a "Remove offline data" control.
- Verification: a runtime scenario in bundled fixture mode saves, goes offline via CDP, reloads and asserts the map reaches `idle` and a pin renders.

---

## Cross-cutting checklist for every release

1. `npm run lint`, `npm test`, `npm run verify -- --quick` locally.
2. Full `npm run verify` on the GPU runner; `npm run verify:approve` only when the release intentionally changes pixels, and say which screenshots changed in the PR.
3. `verification/payload.ts` extended for any new generated file; no new field on places or visits without a DATA.md sentence.
4. A DECISIONS paragraph for each design choice and an EVOLUTION entry with before/after numbers from the report.
5. README "Explore the atlas" updated for new controls and shortcuts.

## Suggested order of work

Start with 0 and 1 in the first week; they are small and unblock gated PRs. Then 2 and 3 in parallel. Then 4, which is the foundation for 5, 6 and 7. Finish with 8 and 9, which touch tooling rather than the map.
