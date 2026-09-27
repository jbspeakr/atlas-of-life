/** Zoom thresholds where each semantic layer becomes the pointer target. */
export const regionZoom = 3.5;
export const placeZoom = 6.5;
export type ActiveLayer = "countries" | "regions" | "pins";
export function activeLayer(zoom: number): ActiveLayer {
  return zoom >= placeZoom ? "pins" : zoom >= regionZoom ? "regions" : "countries";
}
