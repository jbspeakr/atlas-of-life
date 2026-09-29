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
/** Places outside a focused journey recede instead of disappearing. */
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
