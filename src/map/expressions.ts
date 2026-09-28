import type { ExpressionSpecification } from "maplibre-gl";
export const bands: Record<
  "country" | "region" | "pin" | "countryLabel" | "regionLabel" | "route",
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
  // Journey lines arrive with the regions and stay thin beneath the pins.
  route: [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0,
    3,
    0,
    4.25,
    0.55,
    16,
    0.55,
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
