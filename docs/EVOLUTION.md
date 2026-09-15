# Evolution

Only measured experiments belong here. Optimisation uses the ordered objective in the brief; correctness, publication safety, accessibility and network purity are never traded away. Visual changes require explicit approval. Failed checks are fixed, not retried into acceptance.

## Establishing the instrument

The empty-project quick run exited 1 with missing config/types/build/geometry/budget failures; the full red run additionally failed on missing `dist/index.html`. This preceded the application pipeline. A real single-country globe was then rendered with local vector tiles and photographed before expanding the data pipeline. The evaluator is pinned to **the exact style-spec version used by MapLibre**, 24.10.0, rather than the independently latest package.

## Implementation measurements (before a green baseline)

These are corrective implementation steps, not claimed optimisation experiments against an approved baseline:

| Observation | Correction | Measured result |
|---|---|---|
| Inline generated geometry inflated JS to 589,864 gzip bytes | Emit generated style as a JSON asset, attach its GeoJSON objects directly to MapLibre | JS 365,223 gzip bytes; geometry remains separately budgeted |
| Importing every default MapLibre icon/control stylesheet cost 75,976 CSS bytes | Keep the canvas/navigation CSS used by this app; no default marker, popup or fullscreen assets | CSS 8,089 bytes |
| Initial font metrics caused CLS 0.000295489 | Preload the two self-hosted fonts from their exact public URLs | CLS 0 on the measured cold 4G run |
| Broad country hit search selected a different semantic layer | Exercise the actual country fill layer | Real country pointer click passes |
| Coordinate audit recomputed safe inputs but did not compare outputs | Audit JSON, JS place literals and generated pin geometry against expected public coordinates | Zero emitted coordinate mismatches on the fixture |
| City identity differed between collapsing, captions and deep links | Share country + resolved region + normalized city identity | All consumers use the same identity; repeat-city chronology retained |
| Tippecanoe emitted a normalized MBTiles `tiles` view | Materialize a fresh flat, unique-coordinate union instead of indexing the view | Full extraction and archive verification succeeded: 211,759,571 bytes |
| Initial rotation check sampled before the last country finished ignition | Wait for all fixture countries to finish their rise before measuring idle drift | Correction pending the next recorded full run |

The last pre-approval full run measured 365,598 bytes gzipped JS, 8,069 bytes CSS, 41,632 bytes WOFF2, 250,765 bytes gzipped boundary LODs, 956,873 first-view transferred bytes and 14 requests. Cold 4G FCP was 2,444 ms, warm FCP 20 ms, normal first idle 414.4 ms, heap 32,359,140 bytes. Five normal-motion choreography p95 values were 17.558, 20.275, 21.528, 22.55 and 22.718 ms (median 21.528, spread 5.16). The numeric 24 ms gate passed, but an erroneous harness status override treated the instability flag as a numeric failure. Missing approved screenshots correctly remained failures. No green or stable baseline was claimed at this stage.

## Experiment: remove unused sprite loading

Hypothesis: a style with no `icon-image`, `fill-pattern`, `line-pattern` or `background-pattern` consumers does not need a sprite URL. Removing only that runtime dependency should reduce first-view requests/bytes without changing any pixel. The vendored upstream sprite files remain available in `public/sprites/`; this experiment changes loading, not asset provenance or cartography.

The immediately preceding full run passed all 57 checks and set the baseline: p95 median **18.147 ms**, five-run spread **5.464 ms** (flagged unstable); first view **946,789 bytes / 14 requests**; visual diff **0**; 30 direct dependencies, 6 runtime dependencies. The timing spread is explicitly not evidence of a stable causal speedup. Acceptance requires all gates and zero visual diff, reduced bytes/requests, and no measured median p95 regression.
