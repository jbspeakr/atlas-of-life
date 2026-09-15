# Decisions

## Stack and scope
Vite 7, React 19, TypeScript 5, MapLibre GL JS 5.24 or newer within major 5, PMTiles 4, Zod, Vitest and Playwright are resolved to exact installed versions in the lockfile. MapLibre circle and symbol layers provide the marks, glow and collision handling without deck.gl: a second rendering engine does not earn its dependency and interoperation cost here. All authored information is geographic, dates or non-personal tags. City publication precision is the default; explicit landmark overrides are intentional public disclosures.

## Art direction
The palette is midnight `#080f18` (ocean), basalt `#121c27` (land), contour `#2b3947` (linework), lamplight `#efc784` (the single warm accent), parchment `#f1eee7` (primary text), and mist `#a7b2bf` (secondary text). Fraunces supplies distinctive, softly sculpted place names and the opening title; Inter supplies quiet controls. Both are self-hosted WOFF2 with their licence files. The map fills the viewport; an editorial title sits upper left, a restrained chronological index lower left, a thin year control across the foot, and navigation upper right. The selected place is a typographic caption, never a story card. No photographs, personal names, notes, decorative gradients, or unrelated content are supported.

## Motion
The only autonomous entrance is the globe drawing in and countries lighting in first-visit order. Deterministic mode and reduced motion disable this and idle rotation. Zoom-dependent paint expressions keep all semantic layers present, overlapping continuously. The timeline remains because dates are core geographic metadata; it changes feature-state, never source identity. Navigation uses bounding boxes and a weighted cubic easing; the globe and compass are always recoverable.

## Verification contract
The verification harness precedes application code. Missing outputs, assets, runtime interfaces and visual baselines are failures, not skips. Baselines are approved only by the explicit approval command. Runtime instrumentation is exposed through `window.__atlas` for a fixed production-browser choreography; the normal application does not fetch any verification resources. Full verification serves the build under `/atlas/`, at a pinned viewport and DPR, and records objective metrics including instability rather than hiding it with retries.

## Boundary and publication architecture
Build-time processing owns all sensitive fields. Runtime places have an explicit allowlist and never import the authored config or geocode cache. Countries use Natural Earth's `ISO_A2_EH`; ADM1 uses per-country geoBoundaries gbOpen with documented Natural Earth fallback. Download manifests pin bytes by SHA-256. Offline normal builds use committed fixture boundaries and warm geocodes; source refresh is explicit. Two weighted Visvalingam LODs and interior label anchors keep geometry compact and navigation reliable.

## Hosting status
Hosting is not yet selected. Browser compatibility must be measured using real public archive URLs; no authenticated bucket, unpublished account resource or mutable reference will be represented as verified. The repository will support a supplied immutable remote URL and a genuinely self-contained bundled archive. Missing owner credentials and candidate URLs will be reported separately from measured public endpoints.

## Correcting the instability reporting contract
The first harness implementation incorrectly overrode a numerically passing p95 check with `fail` whenever its five-run spread exceeded 20%. The brief explicitly says to **gate on the median and flag instability**, not to replace the 24 ms gate with a stability gate. One measured run had median 21.528 ms and spread 5.16 ms: it should report `pass`, `unstable: true`, not claim 21.528 exceeded 24. This correction is isolated in its own commit with this explanation. The 24 ms p95 budget, 32 ms long-frame definition, long-frame limit, all five samples and the 20% instability flag remain unchanged. Flagged results remain visible evidence and are not treated as proof of a stable performance improvement; no retries or quarantine are used to force green.
