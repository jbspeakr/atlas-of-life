# Decisions

Why the atlas looks and behaves the way it does. Each paragraph is a settled choice a future maintainer might question; add one whenever you decide something of that kind.

## Stack and scope

Vite, React, TypeScript, MapLibre GL JS 5, PMTiles 4, Zod, Vitest and Playwright, pinned to exact versions in the lockfile. MapLibre's own circle and symbol layers provide marks, glow and collision handling; a second rendering engine such as deck.gl would not earn its dependency cost. There is no backend and no database: the output is static files. Authored visits contain only country, city and dates; IDs and labels are generated. No photographs, personal names, notes, tags or stories are supported.

## Art direction

The palette is midnight `#080f18` (ocean), basalt `#121c27` (land), contour `#2b3947` (linework), lamplight `#efc784` (the single warm accent), parchment `#f1eee7` (primary text) and mist `#a7b2bf` (secondary text). Fraunces sets titles and place names; Noto Sans sets controls and map labels, and the same family serves the map glyphs so two typefaces suffice. Both are self-hosted WOFF2. The map fills the viewport: a compact title upper left, the directory lower left, the timeline lower right, World and Tour upper right. The selected place is a typographic caption, never a story card. No gradients, except the globe's halo.

The day theme is the same atlas printed on paper: `#e9e6df` paper, `#1e2731` ink, `#56626e` muted, with lamplight deepened to ochre `#c98a22` for marks and `#875a10` for text and focus rings so both clear 4.5:1. Colours are semantic CSS tokens with a value per theme, and the map uses one style in which every colour that differs is a `case` on the `theme` global state at the leaf, so zoom interpolation stays top-level and a switch cross-fades without a reload. The page follows the system appearance until the viewer chooses; a 361-byte inline boot script sets the theme before first paint and its hash is the only inline script the CSP allows.

Night draws a sparse, seeded, static starfield behind the globe on a 2D canvas, drifting at a third of the surface speed as the globe turns and fading out by zoom 3.5. Nothing twinkles. Both themes draw a soft halo from the limb. MapLibre's own sky is not used because on the globe it offers only a fixed blue atmosphere.

## Motion

The only autonomous motion is countries lighting in first-visit order at load, and the tour, which starts only from its button, yields to any input and reuses the recorder's shots so the movie and the app agree. Everything else is stationary: programmatic camera moves never happen without a user action. North stays up; rotation and pitch are disabled, so there is no compass. The timeline changes feature state, never source identity; its positions are the visits rather than calendar years so a dense year is scrubbable. The address bar describes what is on screen (place, moved camera, filter) so any view can be shared, and programmatic moves never write it. Deterministic mode and reduced motion disable the entrance and hold the tour's shots instead of flying.

## Journeys and home

Journeys are inferred from adjacent dates, not authored itineraries, because the owner's workflow is country, city and dates only; the optional `trip` label exists for a gap or a deliberate public name. Connections are symmetric arcs bowed by 14 % of their length, drawn as round-capped dots, never solid lines, and never as straight great circles: a straight line reads as the road taken, which the atlas does not know. Curved flows are read more accurately and preferred (Jenny et al., *Design principles for origin-destination flow maps*, 2018). Direction comes from numbered stops rather than arrowheads. No connection is drawn in the normal view; a journey appears only in focus, when its members reveal in travel order and everything else recedes to 30 %. The caption's itinerary strip is a schematic whose segments are as wide as the nights stayed, so it cannot be mistaken for geography. MapLibre cannot combine a dash pattern with a line gradient, so the reveal fades whole arcs in sequence.

Home is the origin journeys leave from and return to, drawn as a hollow parchment ring. It is also a place lived in, so it travels through the build as an open-ended city visit under the home's own ID: its region and country light, and it counts among the places, regions, countries and coverage. It is not a trip: the ring is its only mark (its place draws no pin), it never joins a journey or earns a leg, and the statistics leave it out of the visit count, the nights, the year rows and the dated milestones, so moving house is never "the first visit". Treating home as no visit at all was rejected because the home city and region then showed as never visited. Its legs are dotted more sparsely at half strength because they are context. Home publishes at city precision only.

## Numbers

Coverage is measured against the 195 United Nations member and observer states because that is the number travellers already compare themselves with; the atlas accepts every ISO 3166-1 code, so a visited territory is counted beside the states rather than inflating the share. Continent membership comes from Natural Earth's `CONTINENT` field, with the UN M49 geoscheme for the handful of ocean states and territories Natural Earth files under "Seven seas", and is committed as a table so fixture builds stay offline. Distance is the great-circle length of the arcs actually drawn, reported as "at least": the atlas does not know the road taken. The furthest point is measured from the home in effect on the visit's first day. Milestones reference places, homes and journeys by public ID and the browser resolves labels and coordinates from files it already holds, so statistics never add a field to the payload. A year-versus-year map mode was deferred: it needs a second feature-state channel and new baselines.

## Boundaries and publication

Build-time code owns every sensitive field. The browser reads only `src/generated/`, whose files carry an explicit allowlist of public fields; it never imports the authored config or the geocache. Coordinates publish at city precision unless a visit opts into `exact`.

Countries come from Natural Earth (`ISO_A2_EH`, with `XK` for Kosovo); subdivisions from per-country geoBoundaries gbOpen with Natural Earth as fallback. Geocoder administrative codes are provenance, not boundary identifiers: a region is discovered by locating the city's point inside the source polygons. Geometry without an ISO code keeps a stable provider-scoped identity. An uncovered city stays visible without an invented region; malformed sources, failed downloads and checksum mismatches are errors. Provider years and levels are not harmonised to current ISO definitions.

Geometry ships as two weighted-Visvalingam levels of detail with interior label anchors taken from the largest polygon, so a country with overseas territories is labelled at home. The coarse level is embedded in the style so the globe paints from one request; the fine level is a hashed immutable asset fetched when the viewer reaches the band where its detail shows, and feature state is re-applied after every swap. A coarse earth underlay from lower zooms of the same archive keeps land continuous outside the city windows. Non-visited basemap colours are desaturated so lamplight stays the only warm colour.

## Mobile

A phone gets one surface at a time. The directory is a full-width bottom sheet whose bottom edge follows the visual viewport, so it rises with the keyboard; opening it focuses the close button rather than the search field so the keyboard appears only when the viewer taps to type. The field uses 16 px text so mobile Safari does not zoom. A tap within 24 px selects the nearest pin, journey stop or home ring (8 px for a mouse), and a label is a target too. The mobile globe uses a smaller camera scale so it fits 375 px.

## Offline

The service worker is generated by the build from the emitted file list rather than by a framework plugin, so the precache is exactly the shell and the dependency count is unchanged. The tile archive is never precached; where it is bundled, saving it is the viewer's explicit choice, and the worker serves it back by byte range so PMTiles needs no special casing.

A new worker never takes over a running page. GitHub Pages caches HTML for ten minutes and a deploy removes the previous build's hashed files, so a page from before a deploy can still be running when the next worker installs; activating at once would delete the old shell under it and its next request for a hashed file would fail. The worker therefore waits until no page runs the old build, installs past the HTTP cache and revalidates every navigation. Remote tiles bypass it. It registers only after the first idle map, so its install never competes with the first view for bandwidth. If a hashed file still answers 404, the page reloads once and reports a second failure.

## Basemap hosting

The production basemap is a Protomaps extract served from a Hugging Face dataset resolve URL pinned to a full commit SHA: measured in a real browser, it answers exact byte-range requests with the CORS headers PMTiles needs. Cloudflare R2 works too, provided the owner's CORS rule exposes `Content-Range` as well as `ETag`. Without a configured URL the repository runs its committed preview archive; explicit remote mode refuses a missing URL, mutable revisions and dated planet-build URLs, so no third-party endpoint is ever wired in by accident. The full extract stays out of Git; the 22 MB preview archive is committed for verification. `pmtiles extract` writes PMTiles, so the build script converts through `tile-join` to merge overlapping city windows without duplicated features.

The Pages workflow reads its base path from `actions/configure-pages` before Vite runs, so a custom domain gets `/` and a project site `/repository/` without hardcoding either.

## Verification

The harness precedes application code. Missing outputs, assets, runtime interfaces or baselines are failures, not skips. Baselines are approved only by the explicit approval command. Full verification serves the build under `/atlas/` at a pinned viewport and DPR, records objective metrics, gates frame time on the median p95 and flags instability rather than hiding it with retries. Hosted CI runs only the quick gate. Full verification needs a real GPU and exact platform PNGs, so it is a local step on the maintainer's machine before merging any change that touches rendering, motion or pixels. There is no self-hosted GPU runner and none is planned: it would need a persistent machine holding no personal credentials, fenced from fork code, for a one-person site. The Cloudflare deployment job stays commented and rebuilds with `/` rather than reusing the Pages subpath.

## Accessibility

Every control has an accessible name, a keyboard path and a visible focus ring; axe runs in full verification on every surface. Repeated-visit aliases replace their canonical hash instead of pushing history, so Back never traps. Escape closes what is open and returns focus to where it came from.
