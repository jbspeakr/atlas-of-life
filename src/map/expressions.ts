import type { ExpressionSpecification } from "maplibre-gl";
export const bands: Record<
  | "country"
  | "region"
  | "pin"
  | "countryLabel"
  | "regionLabel"
  | "home"
  | "homeLabel"
  | "focus"
  | "focusLabel",
  ExpressionSpecification
> = {
  country: [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.8,
    2.75,
    0.8,
    4.25,
    0.08,
    6,
    0.025,
    16,
    0.025,
  ],
  region: [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0,
    2.75,
    0,
    4.25,
    0.7,
    5.75,
    0.7,
    7.25,
    0.08,
    16,
    0.08,
  ],
  pin: ["interpolate", ["linear"], ["zoom"], 0, 0, 5.75, 0, 7.25, 1, 16, 1],
  // Home is a quiet ring that arrives with the regions and stays.
  home: ["interpolate", ["linear"], ["zoom"], 0, 0, 2.75, 0, 4.25, 1, 16, 1],
  homeLabel: ["interpolate", ["linear"], ["zoom"], 0, 0, 4, 0, 5.25, 1, 16, 1],
  // A focused journey is legible from the continent view inwards.
  focus: ["interpolate", ["linear"], ["zoom"], 0, 0, 1, 0, 2.25, 1, 16, 1],
  // Stop names name the constellation until the pins' own labels take over.
  focusLabel: [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0,
    1.5,
    0,
    2.75,
    1,
    5.75,
    1,
    7.25,
    0,
    16,
    0,
  ],
  // Names appear once their fills are the subject and yield to the next band.
  // Ramps span 1.25 zoom so quarter-zoom samples never jump more than 0.2.
  countryLabel: [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0,
    2,
    0,
    3.25,
    1,
    3.75,
    1,
    5,
    0,
    16,
    0,
  ],
  regionLabel: [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0,
    4,
    0,
    5.25,
    1,
    6.25,
    1,
    7.5,
    0,
    16,
    0,
  ],
};
/** The piecewise-linear value of a zoom band at one zoom. */
export function bandAt(band: ExpressionSpecification, zoom: number): number {
  const stops: [number, number][] = [];
  for (let i = 3; i < band.length; i += 2)
    stops.push([band[i] as number, band[i + 1] as number]);
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, v0] = stops[i - 1];
    const [z1, v1] = stops[i];
    if (zoom <= z1) return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
  }
  return stops[stops.length - 1][1];
}
/**
 * Kilometres that 28 px span at each zoom near 52° latitude: a day trip's
 * satellite and lens stay hidden while its place would sit on top of its base,
 * and bloom over one zoom level once the two come apart on screen.
 */
export const apartKm = (zoom: number): number => (zoom >= 12 ? 0 : 1358 / 2 ** zoom);
/**
 * A focus band for day-trip marks: each output is the band's value times a
 * per-feature test of its `km` distance against the zoom's threshold, so the
 * mark fades in as the viewer zooms towards its base. Folded into one
 * interpolation because zoom must stay the top-level input.
 */
export function apart(
  band: ExpressionSpecification,
  factor: ExpressionSpecification | number = 1,
): ExpressionSpecification {
  const zooms = [...new Set([0, 1, 2, 2.25, 2.75, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16])].sort(
    (a, b) => a - b,
  );
  const result: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"]];
  for (const zoom of zooms)
    result.push(zoom, [
      "*",
      bandAt(band, zoom),
      ["case", [">=", ["coalesce", ["get", "km"], 0], apartKm(zoom)], 1, 0],
      factor,
    ]);
  return result;
}
/** Multiplies every output of a zoom band; zoom must stay the top-level input. */
export function scaleBand(
  band: ExpressionSpecification,
  factor: ExpressionSpecification | number,
): ExpressionSpecification {
  const result = structuredClone(band);
  for (let i = 4; i < result.length; i += 2) {
    const value = result[i];
    result[i] = ["*", value as ExpressionSpecification, factor];
  }
  return result;
}
export function withVisibility(
  band: ExpressionSpecification,
  opacity = 1,
): ExpressionSpecification {
  const result = structuredClone(band);
  for (let i = 4; i < result.length; i += 2) {
    const value = result[i];
    result[i] = [
      "*",
      typeof value === "number" ? value * opacity : ["*", value, opacity],
      ["coalesce", ["feature-state", "visibility"], 1],
    ];
  }
  return result;
}
/** Places, regions and countries outside a focused journey recede instead of disappearing. */
export const undimmed: ExpressionSpecification = [
  "-",
  1,
  ["*", 0.7, ["coalesce", ["feature-state", "dim"], 0]],
];
/** Staged reveal of a focused journey, driven per feature. */
export const revealed: ExpressionSpecification = [
  "coalesce",
  ["feature-state", "reveal"],
  0,
];
