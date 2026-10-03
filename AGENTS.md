# AGENTS.md

A map of this repository for coding agents. Read it before changing anything; it tells you where things live, which commands prove a change, and which rules are not negotiable. Human-facing documentation is in [README.md](README.md) and [`docs/`](docs).

## What this is

**Atlas of a Life** is a static, single-page night-sky atlas of places someone has visited. One MapLibre globe zooms continuously from world to countries to regions to places. The owner authors only country, city and dates in `data/visits.ts`; a build step geocodes nothing, but discovers regions, generates IDs and labels, infers journeys, computes statistics and writes a MapLibre style. The output in `dist/` is plain static files with a strict CSP, deployable to GitHub Pages or any static host.

Stack: Vite 7, React 19, TypeScript 5 (strict), MapLibre GL 6 (ES modules, WebGL2), PMTiles 4, Zod 4, Vitest, Playwright. Node **22.12+**. No backend, no database, no deck.gl.

## Repository layout

```
data/                 Authored input. visits.ts is the only routinely hand-edited file.
  visits.ts             The owner's visits and home base (Config from scripts/config.ts).
  geocache.json         Warm Nominatim cache; written only by `npm run geocode`/`add`.
  sources.json          Pinned boundary source URLs and SHA-256 checksums.
  map-assets.json       Pinned Protomaps glyph/sprite asset revision.
  continents.json       Continent of every country code and the 195 states; written by `npm run continents`.
  boundaries/           Committed geoBoundaries/Natural Earth sources (DEU, FRA, GBR, world).
scripts/              Build-time Node code, run with tsx. Owns every sensitive field.
  config.ts             Zod schema, validation, identity/ID generation, publication policy.
  build-geo.ts          Main generator: boundaries → LODs, places, visits, trips, stats → src/generated/.
  build-style.ts        Emits src/generated/style.json: Protomaps layers and atlas layers in both themes.
  themes.ts             mergeThemes(): folds the night and day palettes into one style via `state.theme`.
  boundaries.ts         Boundary repository, point-in-polygon region discovery, label anchors.
  trips.ts / stats.ts   Journey inference, day-trip bases and arcs; "By the numbers" figures, coverage, milestones, years.
  build-continents.ts   Regenerates data/continents.json from the cached Natural Earth file.
  geocode.ts            The only Nominatim client (explicit command, never in a build).
  add.ts / import.ts / authoring.ts   `npm run add` and `npm run import`.
  photos.ts / photo-sources.ts / clusters.ts   `npm run photos`: osxphotos export → city-days → proposed visits.
  record.ts / recording.ts            Cinematic MP4 recorder (Playwright + FFmpeg).
  build-social.ts / build-icons.ts    Social card and PWA icons (run by hand, output committed).
  service-worker.ts     Source of the generated dist/sw.js (see vite.config.ts).
  build-basemap.sh / publish-tiles.ts Basemap extraction and Hugging Face publishing.
src/                  Browser application.
  main.tsx              The whole React UI: title, directory, caption, timeline, numbers, tour and theme buttons.
  theme.ts              Day/night theme: pre-paint boot script (hashed into the CSP), storage, system follow.
  map/create-map.ts     MapLibre setup, feature state, selection, journeys focus, LOD swaps, `Atlas` API.
  map/expressions.ts    Zoom bands and paint-expression helpers shared with build-style.ts.
  map/router.ts         Hash routes: #/place/<id>, #/view/<z>/<lat>/<lng>, ?through=&mode=.
  map/time.ts           Timeline predicate and dateBounds (shared with scripts/config.ts).
  map/tour.ts           In-app tour; shares shots with the recorder.
  map/text.ts           Diacritic folding and slugs (shared with authoring).
  map/offline.ts        Opt-in offline archive storage.
  map/sky.ts            Night starfield and globe halo, drawn on a 2D canvas beneath the map.
  styles/               tokens.css (semantic colour tokens per theme, type scale), app.css, map.css.
  generated/            Build output. Git-ignored. Never edit by hand.
public/               Static assets copied verbatim: fonts, glyphs, sprites, icons, social card, _headers.
verification/         The verification harness and its fixtures.
  run.ts / entry.mjs    `npm run verify` orchestration; writes verification/report.json.
  contracts.test.ts     Unit contracts (Vitest). boundaries.test.ts, recording.test.ts too.
  runtime.ts / browser.ts / server.ts   Full-mode Playwright choreography, a11y, network audit.
  payload.ts            Publication allowlist audit of everything shipped to the browser.
  style.ts              Style layer/continuity checks.
  budgets.json          Size and performance budgets.
  baselines/            Approved PNG baselines. Written only by `npm run verify:approve`.
  baseline.json         Approved metric objective.
  fixtures/             Fictional visits, geocache and preview basemap used by all verification.
docs/                 GUIDE (operating reference), DATA (authoring), DECISIONS (settled choices),
                      ROADMAP (what is next), ATTRIBUTION, and assets/ (README logo and screenshots).
.github/workflows/deploy.yml   Quick verification on ubuntu-latest, PR comment, Pages deploy.
```

## Data flow

`data/visits.ts` + `data/geocache.json` + boundary sources
→ `scripts/build-geo.ts` (validate, resolve, discover regions, collapse to places, infer trips, compute stats, simplify geometry)
→ `src/generated/*.json|geojson`
→ `scripts/build-style.ts` → `src/generated/style.json`
→ Vite bundles `src/` into `dist/` and emits `dist/sw.js`.

The browser never imports `data/` or `scripts/config.ts`; it reads only `src/generated/`. Setting `ATLAS_FIXTURE=1` swaps in `verification/fixtures/` and forbids all network downloads.

## Commands

| Command | Use it for |
| --- | --- |
| `npm ci` | Install exact dependencies. |
| `npm run dev` | Generate, then serve on 127.0.0.1 with hot reload. |
| `npm run build` | Generate and build `dist/`. `VITE_BASE=/sub/` for a subpath. |
| `npm run generate` | Regenerate `src/generated/` only. |
| `npm test` | Vitest unit contracts. Fast; run after every change. |
| `npm run lint` | ESLint (flat config, typescript-eslint). |
| `npx tsc --noEmit` | Type check (no script alias; quick verification runs it). Needs `src/generated/` to exist, so run `npm run generate` once on a fresh clone. |
| `npm run verify -- --quick` | The CI gate: lint, types, unit, fixture build, style, payload, budgets. Must finish in < 60 s. |
| `npm run verify` | Full run: runtime, a11y, performance, visual diffs. Local only; needs Chromium and a real GPU. Never in CI. |
| `npm run verify:approve` | Writes visual baselines. Only when a pixel change is intended **and** the human asked for it. |
| `npm run add -- CC City YYYY-MM-DD[..YYYY-MM-DD]` | Append a visit and geocode it (needs `NOMINATIM_CONTACT`). |
| `npm run photos -- photos.json` | Propose visits from an osxphotos export, add the confirmed ones and geocode them (needs `NOMINATIM_CONTACT`). |
| `npm run record` | Render MP4 tours (needs FFmpeg with libx264 + ffprobe, Chromium, a z0–6 basemap). |
| `npm run continents` | Rewrite `data/continents.json` after a Natural Earth update (needs the cached full file from a non-fixture generate). |

Before proposing a change as done, run at least `npm test`, `npm run lint`, `npx tsc --noEmit` and `npm run verify -- --quick`, and read `verification/report.json` if anything fails.

## Rules that are not negotiable

1. **Privacy allowlist stays closed.** Runtime payloads carry only the fields allowed in `verification/payload.ts`. A new public field needs an explicit allowlist entry, a documented reason in `docs/DECISIONS.md` and a test. Never import `data/visits.ts` or the geocache from `src/`.
2. **City precision by default.** Coordinates are published at city precision unless a visit sets `publishPrecision: "exact"`. Do not weaken this.
3. **No network in builds or verification.** Geocoding happens only in `npm run geocode`/`add`. Fixture mode (`ATLAS_FIXTURE=1`) must never download. Don't add runtime calls to third-party services; the CSP is generated from explicit tile origins.
4. **Baselines are approved, not regenerated.** Never run `verify:approve` or `--set-baseline` to make a failing check pass. Never raise a budget in `verification/budgets.json` to hide a regression. Don't retry flaky checks into green.
5. **One accent colour, two typefaces, two themes.** Lamplight is the only warm colour (`#efc784` at night, deepened to ochre `#c98a22`/`#875a10` by day); everything else uses the semantic tokens in `src/styles/tokens.css`, and every token and map colour is defined for both themes. Fraunces for titles and place names, Noto Sans for everything else. No new fonts, photos or gradients (the globe halo is the one documented exception).
6. **Stationary camera.** Nothing moves the camera without user input, except the opt-in tour. Respect `prefers-reduced-motion` and `?deterministic=1`.
7. **Accessibility is a gate.** Every control has an accessible name, keyboard path and visible focus; axe runs in full verification.
8. **Don't edit generated files.** `src/generated/`, `dist/`, `verification/report.json` and `verification/artifacts/` are outputs.

## Recipes

- **Add a map layer or change styling:** `scripts/build-style.ts` (layers), `src/map/expressions.ts` (zoom bands and shared expressions), then check `verification/style.ts` for layer-ID expectations. Pixel changes need a baseline approval by a human.
- **Change a colour:** use a semantic token (`--bg`, `--text`, `--accent`, …) in CSS and the `color(role)` helper in `build-style.ts`; give it a night and a day value. The `theme.palettes` style gate checks the built style.
- **Add a UI control:** `src/main.tsx` plus `src/styles/app.css`. Mirror the existing pattern: `aria-label`, `aria-keyshortcuts` where there's a key, hide `kbd` hints under 700 px.
- **Add a published field or generated file:** produce it in `scripts/build-geo.ts`, extend `verification/payload.ts` and add a contract in `verification/contracts.test.ts`.
- **Change authoring rules:** `scripts/config.ts` (schema and identity). IDs must stay stable for unrelated edits; see the ID section of `docs/DATA.md`.
- **Change the tour:** shots are shared by `src/map/tour.ts` and `scripts/record.ts`; keep them in agreement.

## Documentation conventions

- `README.md` is the pitch and the quick start. Operating detail goes into `docs/GUIDE.md`, authoring detail into `docs/DATA.md`.
- `docs/DECISIONS.md` gets a paragraph whenever you decide something a future maintainer might question.
- Measured results (before/after numbers from `verification/report.json`) go into the pull request description, never estimates. There is no changelog file; the git history is the record.
- Docs describe the current state only. Do not add history, superseded approaches or measurement anecdotes; if a past choice matters, one sentence in `docs/DECISIONS.md` saying what was rejected and why is enough.
- British spelling in prose (colour, licence, optimise). Plain, direct sentences.
- README images live in `docs/assets/`. The wordmark SVGs are Fraunces 500 outlines (no font dependency) in a light and a dark variant, switched with `<picture>` and `prefers-color-scheme`; `atlas-wordmark.svg` adapts on its own for other contexts. Screenshots are WebP captured from `npm run preview` with `?deterministic=1` and an explicit `&theme=dark` or `&theme=light` (headless browsers otherwise report a light system theme). The README hero slot is meant for a tour recording from `npm run record -- --format landscape` with a complete z0–6 basemap, supplied by the maintainer.
- Commits use Conventional Commit prefixes as in the history: `feat:`, `fix:`, `perf:`, `docs:`, `ci:`, `refactor:`. One logical change per commit.

## Environment gotchas

- The committed preview basemap (`verification/fixtures/basemap.pmtiles`, copied to `public/tiles/` on first generate) covers only global z0–3 and six small city windows. It is enough for the app and verification, not for `npm run record`, which needs global z0–6 (`npm run basemap:build`).
- Full verification needs real GPU acceleration; software renderers fail performance gates on purpose. Hosted CI runs only `--quick`; the full run is always local, and there is no CI runner for it by decision. Pixel changes ship with baselines the maintainer approved locally.
- `npm run record` and full verification both use fixed ports (4180 for the recorder); don't run them concurrently.
- Nominatim requires a real contact in `NOMINATIM_CONTACT` and at most one request per 1.1 s. Don't bulk-refresh the geocache.
