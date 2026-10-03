# Roadmap

Where Atlas of a Life goes next. The bar is set by the best of the category, not by what is easy: Polarsteps and Been for the share-worthy summary, AdventureLog for statistics and import, Mapiful for the poster on the wall, Fog of World for the feeling of a life slowly covering the map. The atlas keeps what makes it different while it gets there: an owner authors only country, city and dates; nothing about a person leaks; the camera never moves on its own; one accent, two typefaces, two themes; plain static files.

Every item below respects those rules. Anything that adds a public field goes through the payload allowlist and a sentence in [DATA.md](DATA.md). Anything that changes pixels ships with baselines approved in a local full verification run.

## Themes

| Theme | What the viewer gets |
|---|---|
| [Hold it in your hands](#1-hold-it-in-your-hands) | A poster, a rich link preview for every place, an atlas that embeds in your own site and reads aloud. |
| [Time made visible](#2-time-made-visible) | Replay the years, a year in review, a life line, trips still to come. |
| [Under the actual sky](#3-under-the-actual-sky) | The real stars over a place on the night you were there, and the weather that day. |
| [Numbers that mean something](#4-numbers-that-mean-something) | Then and now on the map. |
| [Authoring without a laptop](#5-authoring-without-a-laptop) | Add a visit from your phone; import from what you already have. |
| [In your language](#6-in-your-language) | The whole interface in German and other languages. |
| [Foundations](#7-foundations) | Baselines and the published basemap. |

---

## 1. Hold it in your hands

### 1a. Poster export

A print-quality poster of the atlas: the globe or a chosen region, lit countries, pins, home ring, the focused journey if one is set, and a title line with the totals, typeset in Fraunces and Noto Sans on midnight or paper. Sizes A3, A2 and 50×70 cm at 300 dpi, portrait and landscape. Mapiful sells this by the thousand; here it is generated from your own data with no upload.

- **How.** `npm run poster -- --size A2 --theme day [--journey <id>] [--view <zoom>/<lat>/<lng>]` drives the existing Playwright helpers from `scripts/build-social.ts` at a device pixel ratio that yields 300 dpi, with a `?poster=1` mode that hides the chrome and lays out the title block from `stats.json`. A print stylesheet (`@media print`) gives the browser's own print dialog the same layout for a quick A4.
- **Rules.** Same style, same fonts, same tokens; nothing new is drawn. The basemap must cover the chosen view, so this wants the complete published archive (7b).
- **Done when** a 300 dpi A2 PNG and a PDF render for both themes, and a sample poster sits in the README gallery.

### 1b. A rich preview for every place, journey and year

Paste a place link into a chat and see a card with the place name, its dates, and the globe lit around it. Today one static social card serves every link because the app is a single page.

- **How.** The build renders `social/<id>.png` for each place and journey with the social-card script, and emits a tiny static stub per link (`p/<id>/index.html`) carrying the Open Graph and Twitter tags and a meta refresh plus a script-free link to `#/place/<id>`. The app's copy-link control (1c) hands out the stub URL. Service worker and payload audit gain the stubs; the audit verifies that a stub carries only the public label and dates.
- **Rules.** Cards show city-precision globe views only, never a street. Rendering is a build step, not a runtime call.
- **Done when** a place link previews with its own image in Signal, Slack and Mastodon, and `data.payload-purity` covers the stubs.

### 1c. Copy link, and a chrome-less embed

A "Copy link" control in the caption and the journey view, and an `?embed=1` mode that hides the title, directory, timeline and buttons so the atlas sits inside a blog post as an iframe. A documented snippet with `loading="lazy"` and `allow="fullscreen"`; the CSP already permits framing on the same origin, so `frame-ancestors` gains the owner's site from `VITE_EMBED_ORIGINS`.

- **Done when** an embedded atlas on another origin selects a place, follows its own hash, and the a11y scenario passes in embed mode.

### 1d. Reader mode

A text edition of the atlas, generated at build: a chronological narrative ("April 2024 · Berlin becomes home. May 2025 · five nights in Kalamos, Attica…") with the totals, served as `/atlas.txt` and as a "Read as text" view inside the page. It is the atlas for screen readers, for `curl`, for a machine without WebGL, and for search engines, which today see an empty page.

- **How.** `scripts/build-reader.ts` from the public places, visits, trips and stats; the in-page view reuses the caption typography. The runtime a11y scenario reads it with axe.
- **Done when** every public fact of the atlas is reachable without the map.

## 2. Time made visible

### 2a. Replay

Press play on the timeline and watch the years pass: the scrubber advances one visit at a time at a readable pace, countries light in order, and each journey reveals its arcs as it happens, on a stationary camera. Twenty seconds for a decade. It is the ignition sequence, made scrubbable and paired with the routes.

- **How.** A play/pause control beside the scrubber drives `filter()` through the existing `positions` with the reveal stagger already used for journey focus. Reduced motion steps without easing. `?replay=1` starts it from a link. The recorder gains a `--replay` shot so the MP4 can tell the same story.
- **Rules.** The camera stays where the viewer left it; only feature state changes.
- **Done when** replay on the fixture matches its frames in the visual gate and the p95 frame budget holds during playback.

### 2b. Year in review

A page per year: countries first visited, new places, nights away, the longest journey, the furthest point from home, drawn as a small globe with only that year lit, and a share card (1b) to match. `#/year/2025` lights the year and opens the panel; the By the numbers panel links to it.

- **How.** `stats.ts` already computes per-year rows; extend with per-year firsts and extremes. The card is rendered by the social build. The panel reuses the numbers layout.
- **Done when** every year with a visit has a linkable review and a card, and Wrapped-style sharing works from a phone.

### 2c. The life line

A second view of the same data: a horizontal line of years with homes as long bars and journeys as short ones, in Fraunces, keyboard navigable. Hover or focus a bar and the map lights it; select one and the caption opens. It answers "where was I in 2023" without scrubbing.

- **How.** A collapsible strip above the timeline, rendered from `home.json`, `trips.json` and `visits.json`. On phones it becomes a scrollable row in the sheet.
- **Done when** every bar has an accessible name, arrow keys move between them, and the mobile a11y run passes.

### 2d. Trips still to come

Visits dated in the future render as hollow pins with a dashed ring, their journey arcs dotted more sparsely, and the caption reads "in 23 days". Journeys export as an `.ics` file so the plan lands in a calendar; the count line gains "next: Lisbon, in 23 days".

- **Rules.** Future dates are already valid input; nothing new is published beyond what the owner authored.
- **Done when** a future visit is distinguishable in both themes and the `.ics` validates.

## 3. Under the actual sky

### 3a. The real night sky

Behind the globe, at night, the starfield stops being decoration: when a place is selected, the canvas draws the actual sky over that city at midnight on the first night of the visit. The Bright Star Catalogue (about 9,000 stars, under 100 KB gzipped as a compact typed array) gives the positions; a sidereal-time calculation places them. Stars stay still; the brightest twenty carry their names in mist. Nothing else on the web does this for a travel map, and it is exactly what "atlas of a life" under a night sky promises.

- **How.** `src/map/sky.ts` gains a `skyAt(lat, lng, date)` projection using the existing globe geometry; the catalogue ships as a hashed asset loaded on first selection. Deterministic mode pins the date. Day theme unchanged.
- **Rules.** City precision and the visit date are already public; nothing new leaks. No twinkle, no motion, one accent.
- **Done when** Polaris sits at the right altitude for Berlin and Kalamos in a contracts test, and the night baselines are approved.

### 3b. The weather that day

The caption gains one line: "18° and clear · sun set 21:34". Daily high, low and sunshine from the Open-Meteo archive (free for non-commercial use, no key, CC BY 4.0, data back to 1940), fetched once by an explicit command like geocoding and cached in `data/weathercache.json`; sunset from the sun's geometry with no network at all. A single evocative detail turns a date into a memory.

- **How.** `npm run weather` resolves every dated visit at city coordinates, one request per visit, throttled, and never runs inside a build. `weather.json` joins the payload audit with an allowlist of `id`, `high`, `low`, `sunshine`. Attribution joins the credits control and [ATTRIBUTION.md](ATTRIBUTION.md).
- **Rules.** Build and verification stay offline; the fixture ships a warm weather cache.
- **Done when** the owner build carries weather for every dated visit and the fixture caption shows it in a runtime scenario.

### 3c. Day and night on the globe

For a selected visit, a soft terminator shows where it was night on the globe at the moment the caption describes; at the world view, the globe is lit as it is right now. It uses the halo canvas and the sun's position; the day theme shows it as a faint shadow.

- **Rules.** Subtle by design and switchable off in the credits control; reduced motion and deterministic mode pin the time.

## 4. Numbers that mean something

### 4a. Then and now on the map

The numbers panel already sets two years side by side. The map should show the same comparison: one year in lamplight, the other in mist outline, so the growth of a decade is visible in one view.

- **How.** A second feature-state channel beside `visibility`, driven from the Years compared selects; `?compare=2024,2025` for links. Pixel changes, so it follows 7a.

## 5. Authoring without a laptop

### 5a. Add a visit from your phone, with no backend

A GitHub issue form ("New visit": country, city, dates, optional trip) feeds a workflow that runs `npm run add` with the repository's `NOMINATIM_CONTACT` secret, commits the visit and the warmed geocache, and opens a pull request. Merge from the phone; Pages deploys. The installed app gains a "Add a visit" link to the form. Zero servers, zero accounts beyond GitHub.

- **How.** `.github/ISSUE_TEMPLATE/visit.yml` plus `.github/workflows/add-visit.yml`, restricted to the repository owner's issues.
- **Done when** an issue on a phone becomes a mergeable PR with a green quick gate.

### 5b. Import from where the data already is

`npm run photos` reads an osxphotos export today, using the city and country the phone resolved so no lookup is made per photo. Next: let the command run `osxphotos` itself on a Mac, remember the person or album that marks a trip, and read a plain folder of images through their EXIF data for libraries outside Photos. Then Polarsteps and Google Timeline exports (`--from polarsteps export.zip`, `--from google-timeline Records.json`) through the same city-day clustering, with one reverse geocode per cluster under the Nominatim policy, throttled and capped, for the clusters no export already names. Migration from the apps people leave is how a personal atlas earns its first fifty places.

- **Rules.** Reverse geocoding only through the explicit command, never in a build; the result is still country, city and dates.

### 5c. Companions

Two atlases on one globe. A companion's published atlas (their public `places.json` and `trips.json`, nothing else) is pinned in the config by URL and checksum and merged at build, drawn with a second mark and the same accent. "Where we've both been" becomes a filter and a milestone.

- **Rules.** Fetched only at build, like boundaries; no runtime origins are added. Both owners publish only what they already publish.

## 6. In your language

The interface in German first, then any language a contributor adds. Country names and dates already follow the browser; the sixty or so interface strings, the caption grammar ("6 nights", "stop 3 of 8") and the generated journey labels move to message catalogues with plural rules. `?lang=` pins a language for links and verification.

- **How.** `src/i18n/` with ICU-style plurals via `Intl.PluralRules`; the build emits journey labels per language.
- **Done when** the German atlas passes the same a11y run and no string is left untranslated in the contracts test.

## 7. Foundations

Work that makes everything above cheaper and safer.

- **7a. Approved baselines.** Run `npm run verify` locally on a machine with a GPU, fix anything non-visual that fails, approve with `npm run verify:approve`, set the metric baseline, commit.
- **7b. The complete published basemap.** Global z0–6 with city detail on a pinned Hugging Face SHA, as described in the [guide](GUIDE.md#basemap-deployment). Unblocks the poster, the recorder and the README hero.
- **7c. Linkable journeys and During on phones.** `#/journey/<id>` in the router; the Through/During control on narrow screens.

## Suggested order

| Order | Item | Why now |
|---|---|---|
| 1 | 7a, 7b | Everything with pixels or a wide view depends on them. |
| 2 | 1c, 1d, 7c | Small, no pixels, immediately useful. |
| 3 | 3b | Build-time data, high delight per line of code. |
| 4 | 2a, 2b, 1b | The share story: replay, year in review, rich links. |
| 5 | 3a, 1a | The signature pieces: the real sky and the poster. |
| 6 | 5a, 5b | Authoring reach. |
| 7 | 2c, 2d, 6, 3c, 4a, 5c | As appetite allows. |
