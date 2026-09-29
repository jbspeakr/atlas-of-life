# Roadmap

What comes next for Atlas of a Life, in the order it should be done, and a short record of what has shipped. Measured results live in [EVOLUTION.md](EVOLUTION.md); the reasoning behind settled choices lives in [DECISIONS.md](DECISIONS.md). Reviewed on 2026-09-29.

## Ground rules

- **Publication allowlist stays closed.** Anything new that ships to the browser is derived from the existing public fields or is an explicitly documented new public field with a `verification/payload.ts` entry.
- **One accent, two typefaces, two themes.** Lamplight remains the only warm colour; every token and map colour has a night and a day value.
- **Stationary camera.** Nothing moves the camera without user input, except the opt-in tour.
- **Baselines are approved, not regenerated.** Full verification is a local step on a machine with a real GPU; there is no CI runner for it and none is planned. A change that alters pixels says so up front and ships with baselines approved by `npm run verify:approve`.
- **Every item** ends green under `npm run verify -- --quick`, adds an EVOLUTION entry with numbers from `verification/report.json`, and adds a DECISIONS paragraph where it decides something.

## Order of work

| # | Item | Needs | Changes pixels | Size |
|---|------|-------|----------------|------|
| 1 | Approved baselines and a metric baseline | maintainer's machine | approves them | S |
| 2 | Complete published basemap | maintainer's accounts | no | M |
| 3 | Lighter geometry | measurement first | should be 0 | M |
| 4 | Linkable journeys | – | no | M |
| 5 | During mode on phones | 1 | yes (mobile) | S |
| 6 | Tour frame time as a gate | 1 | no | S |
| 7 | Hero recording for the README | 2 | no | S |
| 8 | MapLibre GL 6 | 1 | likely | M |
| 9 | Tooling bumps | – | no | S |

Items 3 and 4 need nothing from the maintainer's machine and can start at once. Item 5 and 8 change what the browser draws, so they wait for trustworthy baselines from item 1.

---

## 1. Approved baselines and a metric baseline

**Why.** The committed PNG baselines predate every release since the zoom buttons, and `verification/baseline.json` was written when the suite had 21 tests. Every EVOLUTION entry from "Small UX release" onward records its baselines as pending. Until they are approved, the visual, frame-time and first-view gates check nothing.

**Steps.**

1. On a machine with a real GPU: `npm ci`, `npx playwright install chromium`, `npm run verify`.
2. Read `verification/report.json`. Only the six `visual.*` checks are expected to fail, because every screenshot changed. Anything else that fails is a regression to fix first, never to approve.
3. `npm run verify:approve`, then `npm run verify` again and require zero-pixel diffs, then `npm run verify -- --set-baseline`.
4. Commit `verification/baselines/` and `verification/baseline.json` as one `ci:` commit, with an EVOLUTION entry giving the measured p95 frame time, first-view bytes and requests on the fixture.

**Acceptance.** `npm run verify` green locally; the report's `visualDiffPixels` is 0 and `p95FrameMs` is a number, not null.

## 2. Complete published basemap

**Why.** Production remote mode expects a z0–14 archive on a pinned Hugging Face SHA. The 211 MB extract was built and verified locally but never published. This also blocks `npm run record`, which needs global z0–6, and so the README hero recording.

**Steps.** As documented in [GUIDE.md](GUIDE.md#basemap-deployment): `npm run generate`, `npm run basemap:build` against a current Protomaps build, `npm run tiles:publish` into the maintainer's own dataset, then `npm run verify:hosting` against the resolved URL with the site origin and require a pass. Set the repository variables `VITE_BASEMAP_URL` and `VITE_TILE_ORIGINS`, and record in DECISIONS which archive the live site serves.

**Acceptance.** The hosting probe passes for the published URL; a Pages deployment renders city detail in Berlin and Kalamos with zero console errors.

## 3. Lighter geometry

**Why.** The owner build emits about 615 KB gzip of boundary LODs against the 400 KB target. Progressive loading fixed the first-view cost, not the total, and CI measures only the fixture (247 KB).

**Steps, measuring after each.**

1. Add a per-country, per-LOD byte breakdown to the build log. Expect Denmark (Greenland), Norway (Svalbard), France (overseas departments) and the Netherlands (Caribbean) to dominate `countries-fine`, and the Norwegian and Swedish coastlines to dominate `regions-fine`.
2. Add a documented publication rule in `scripts/boundaries.ts`: a country's fine LOD keeps its largest polygon plus polygons within a fixed distance of a published place; the coarse LOD keeps everything so the world view is unchanged. This is a design choice (Greenland stops being lit at zoom 5 when only Copenhagen was visited) and needs a DECISIONS paragraph with the numbers.
3. Tune the simplify intervals in `scripts/build-geo.ts` (currently 2000/250 m for countries, 750/100 m for regions) and compare the region and city captures; the continuity and coverage contracts guard the style side.
4. If still over: split the fine LODs into one hashed asset per country and fetch only the countries in view when crossing the swap zoom. The swap machinery in `create-map.ts` already handles `setData` and feature-state re-application.
5. Last resort: TopoJSON on the wire, decoded in the browser, so shared borders are encoded once. It adds a runtime dependency and needs its own DECISIONS paragraph.

**Acceptance.** `budget.geometry` measured on the owner build under 400 KB; fixture visual diffs at 0 pixels; an EVOLUTION table with before and after per file.

## 4. Linkable journeys

**Why.** The address bar follows a selected place, a moved camera and the filter, but choosing a journey from the directory frames the round trip without any route for it, so a focused journey cannot be shared.

**Steps.** Add `#/journey/<id>` to `src/map/router.ts` with round-trip property tests. The Journeys scope pushes it; `route()` in `create-map.ts` focuses the group and frames its bounds, suppressing ignition as other hashes do; Escape drops the segment; the document title names the journey. Add an `interaction.journey-link` runtime scenario on the fixture.

**Acceptance.** A journey link opens the framed round trip in a second browser; contracts and quick verification green; no pixel change.

## 5. During mode on phones

**Why.** The Through/During control is hidden under 700 px (`src/styles/app.css`), so phones cannot isolate a month. The original release called this the first cut.

**Steps.** Put a two-option control in the timeline label row, or make the label a button that toggles the mode with `aria-pressed`. Keep the 44 px hit target and the URL (`?mode=only`) as the source of truth. Extend the mobile a11y scenario to toggle it. The mobile baseline changes, so this lands after item 1 and ships with an approved `mobile.png`.

## 6. Tour frame time as a gate

**Why.** The in-app tour reports no frame timing; the p95 gate covers only the camera choreography.

**Steps.** Sample p95 frame time over a 5 s tour slice as an informational `perf.tour.p95` row, and after two green local runs promote it to a gate at the same 24 ms budget.

## 7. Hero recording for the README

After item 2, `npm run record -- --format landscape` works with the complete archive. Convert the MP4 to a small looping WebM or animated WebP, replace the placeholder comment above the hero image in the README, and keep `hero.webp` as the poster.

## 8. MapLibre GL 6

`maplibre-gl` 6 and `@maplibre/maplibre-gl-style-spec` 26 are out; DECISIONS pins major 5. Read the 6.0 changelog first: the globe projection, `setGlobalStateProperty`, feature-state semantics and the style-spec version are all in the critical path (`create-map.ts`, `scripts/themes.ts`, `scripts/build-style.ts`). Expect pixel diffs, which is why this waits for item 1. Update the DECISIONS sentence about the pinned major.

## 9. Tooling bumps

Vite 8 and TypeScript 7 as separate pull requests, each gated by quick verification. The remaining minor bumps (`eslint`, `typescript-eslint`, `vitest`, `fast-check`, `mapshaper`, `tsx`, `@types/*`) can go in one `chore:` commit. Check that `mapshaper` does not change simplification output: the fixture geometry bytes in the build log are the tell.

## Later, if the above is done

- Nights per country in By the numbers; the data is already in `stats.json`.
- A "Copy link" control in the caption, since the URL is the sharing surface. Needs a user gesture and no new CSP origin.
- Type-ahead in the directory to the first matching row.
- Splitting `src/main.tsx` and `src/map/create-map.ts` only if either grows past roughly 1,200 lines, with no behavioural change.

---

## Shipped

The September 2026 review plan (commit 639cc77) was implemented in full and merged on 2026-09-28 as [jbspeakr/atlas-of-life#1](https://github.com/jbspeakr/atlas-of-life/pull/1), one commit per release: a hosted quick CI gate; the small UX release (folded search, on-screen zoom, locale-aware names, favicon, social card); country and region labels with hover affordance; progressive geometry; the ordinal timeline with Through and During, shareable URLs and short IDs; journeys; the in-app tour; By the numbers; `npm run add` and `npm run import`; and the installable shell with the opt-in offline archive. Later pull requests added the coarser basemap fallback (#2), home base and curved journeys (#3), the mobile sheet and tap reach (#4), the day and night themes with stars and a halo (#5), and the README and wordmark (#6). Each has a measured entry in [EVOLUTION.md](EVOLUTION.md).
