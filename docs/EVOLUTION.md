# Evolution

Only measured experiments belong here. Optimisation uses the ordered objective in the brief; correctness, publication safety, accessibility and network purity are never traded away. Visual changes require explicit approval. Failed checks are fixed, not retried into acceptance.

## Establishing the instrument

The empty-project quick run exited 1 with missing config/types/build/geometry/budget failures; the full red run additionally failed on missing `dist/index.html`. This preceded the application pipeline. A real single-country globe was then rendered with local vector tiles and photographed before expanding the data pipeline. The evaluator is pinned to **the exact style-spec version used by MapLibre**, 24.10.0, rather than the independently latest package.

## Implementation measurements (before a green baseline)

These are corrective implementation steps, not claimed optimisation experiments against an approved baseline:

| Observation                                                                    | Correction                                                                                     | Measured result                                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Inline generated geometry inflated JS to 589,864 gzip bytes                    | Emit generated style as a JSON asset, attach its GeoJSON objects directly to MapLibre          | JS 365,223 gzip bytes; geometry remains separately budgeted                                          |
| Importing every default MapLibre icon/control stylesheet cost 75,976 CSS bytes | Keep the canvas/navigation CSS used by this app; no default marker, popup or fullscreen assets | CSS 8,089 bytes                                                                                      |
| Initial font metrics caused CLS 0.000295489                                    | Preload the two self-hosted fonts from their exact public URLs                                 | CLS 0 on the measured cold 4G run                                                                    |
| Broad country hit search selected a different semantic layer                   | Exercise the actual country fill layer                                                         | Real country pointer click passes                                                                    |
| Coordinate audit recomputed safe inputs but did not compare outputs            | Audit JSON, JS place literals and generated pin geometry against expected public coordinates   | Zero emitted coordinate mismatches on the fixture                                                    |
| City identity differed between collapsing, captions and deep links             | Share country + resolved region + normalized city identity                                     | All consumers use the same identity; repeat-city chronology retained                                 |
| Tippecanoe emitted a normalized MBTiles `tiles` view                           | Materialize a fresh flat, unique-coordinate union instead of indexing the view                 | Full extraction and archive verification succeeded: 211,759,571 bytes                                |
| Initial rotation check sampled before the last country finished ignition       | Wait for all fixture countries to finish their rise before measuring idle drift                | Normal-motion rotation measured above 0.18° per 500 ms; reduced motion remains at zero render frames |

The last pre-approval full run measured 365,598 bytes gzipped JS, 8,069 bytes CSS, 41,632 bytes WOFF2, 250,765 bytes gzipped boundary LODs, 956,873 first-view transferred bytes and 14 requests. Cold 4G FCP was 2,444 ms, warm FCP 20 ms, normal first idle 414.4 ms, heap 32,359,140 bytes. Five normal-motion choreography p95 values were 17.558, 20.275, 21.528, 22.55 and 22.718 ms (median 21.528, spread 5.16). The numeric 24 ms gate passed, but an erroneous harness status override treated the instability flag as a numeric failure. Missing approved screenshots correctly remained failures. No green or stable baseline was claimed at this stage.

Further verification found and fixed actual behavior, not just test wording: string GeoJSON IDs needed explicit `promoteId` for MapLibre's tiled feature-state binding. The retained smoke path now clicks the rendered pin, and the timeline check measures its pixels (London red channel 239 → 29), rather than echoing a slider value. An address's cached region is retained when resolving its city; a regression first returned the wrong same-named city and now returns the correct city center. A live public-city query also showed that putting `DE-HH` in Nominatim's free-text query yielded POIs rather than Hamburg; the corrected query returns the city while country/region constraints remain enforced separately.

The original broad CDP categories generated 302,433 events / 56.4 MB for just 828 `DrawFrame` timestamps. Inspection showed those frames belong to `disabled-by-default-devtools.timeline.frame`; the instrument now records that exact category without unrelated tracing overhead. This was an instrument correction before the green baseline, not a claimed application speedup. Expected navigation aborts are not application console errors, and network observation no longer pauses requests in a way that races Chromium cancellation.

The first fully green `verify -- --set-baseline` run passed **57 checks**, failed/skipped none, and recorded zero pixel differences. Its objective is committed in `verification/baseline.json`. Subsequent integration reproduced and fixed a repeat-visit hash redirect that trapped browser Back, and an empty-city archive build that incorrectly rejected valid country-only data. The latter now produces a verified **44,694,529-byte** global z0–6 archive. A clean-room bootstrap test also confirmed a missing module still yields exit 1, a human table and a valid failure report instead of leaving stale success data.

## Experiment: remove unused sprite loading — reverted

Hypothesis: with no `icon-image` or pattern consumers in the generated style, removing its sprite URL would reduce first-view requests/bytes without a visual or performance regression. Only sprite loading changed (`scripts/build-style.ts` and `src/map/create-map.ts`); vendored assets stayed intact. The experiment was committed as `376120d` and measured with quick verification followed by a full run. The before measurement was the committed green baseline.

| Metric                          |              Before |                After |     Delta |
| ------------------------------- | ------------------: | -------------------: | --------: |
| Hard failures                   |                   0 |                    0 |         0 |
| p95 frame time, five-run median |           18.147 ms |            23.548 ms | +5.401 ms |
| p95 spread                      | 5.464 ms (unstable) |             2.874 ms |         — |
| First-view transferred bytes    |             946,789 |              929,367 |   −17,422 |
| First-view requests             |                  14 |                   12 |        −2 |
| Visual diff pixels              |                   0 | 39,675, in city view |   +39,675 |
| Direct / runtime dependencies   |              30 / 6 |               30 / 6 |         0 |

**Reverted.** Fewer requests cannot buy a worse measured p95 or an unapproved image change. Timing noise was already flagged in the baseline, so this is not a claim of a proven causal slowdown; it is a refusal to accept an experiment that failed the stated acceptance criteria. No threshold or visual baseline was weakened, and no retry was used to manufacture a passing result. The original sprite-loading behavior is restored.

## Correcting first-view visual capture settling

After restoring the original sprite behavior, the same 39,675-pixel city difference recurred. It was therefore not evidence of a sprite-caused visual change. A focused camera experiment showed that the first city capture differed, waiting one second did not change it, but an additional post-idle render matched the approved image exactly. Merely changing zero-duration `easeTo` to `jumpTo` was insufficient on a cold view. The capture harness now positions static views with `jumpTo`, observes idle, advances one animation frame, and flushes a subsequent idle render before its single comparison. Three successive diagnostic captures, including the cold view, then each differed by **0 pixels**. Timed performance choreography is unchanged; no threshold or approved baseline changed, and comparisons are not retried until they pass. The sprite experiment remains reverted because it also failed its measured p95 acceptance criterion.
