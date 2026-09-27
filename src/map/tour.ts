import type { Place } from "./create-map";

/** Pure camera choreography shared by the in-app tour and the offline recorder. */
export type CameraState = { center: [number, number]; zoom: number };
export type TourPlace = Pick<Place, "id" | "label" | "country" | "coordinates">;
export type GlobeTour = {
  keyframes: { frame: number; camera: CameraState }[];
  overviewZoom: number;
  regionZoom: number;
  posterFrame: number;
};

export function selectTourStops(places: readonly TourPlace[], anchor: TourPlace): TourPlace[] {
  if (!places.length || !places.some((place) => place.id === anchor.id))
    throw new RangeError("A globe tour needs a published anchor place.");
  const candidates = places.map((place) => {
    const longitude = place.coordinates[0] * Math.PI / 180;
    const latitude = place.coordinates[1] * Math.PI / 180;
    return { place, vector: [
      Math.cos(latitude) * Math.cos(longitude),
      Math.cos(latitude) * Math.sin(longitude),
      Math.sin(latitude),
    ] };
  });
  const selected = [candidates.find((candidate) => candidate.place.id === anchor.id)!];
  // Farthest-first on the sphere, preferring new countries over nearby repeats.
  // Dot products avoid treating entries either side of the dateline as far apart.
  while (selected.length < Math.min(4, candidates.length)) {
    let best: typeof candidates[number] | undefined;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (selected.some((stop) => stop.place.id === candidate.place.id)) continue;
      let distance = Infinity;
      for (const stop of selected) {
        const dot = candidate.vector.reduce((sum, value, axis) => sum + value * stop.vector[axis], 0);
        distance = Math.min(distance, 1 - dot);
      }
      const newCountry = !selected.some((stop) => stop.place.country === candidate.place.country);
      const score = distance + (newCountry ? 3 : 0);
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    if (!best) break;
    selected.push(best);
  }
  // Visit nearby representatives in sequence rather than zigzagging across them.
  const route = [selected.shift()!];
  while (selected.length) {
    const previous = route[route.length - 1];
    let nearest = 0, nearestDot = -Infinity;
    for (let i = 0; i < selected.length; i++) {
      const dot = previous.vector.reduce((sum, value, axis) => sum + value * selected[i].vector[axis], 0);
      if (dot > nearestDot) { nearest = i; nearestDot = dot; }
    }
    route.push(selected.splice(nearest, 1)[0]);
  }
  return route.map((stop) => stop.place);
}

export function createGlobeTour(
  stops: readonly TourPlace[],
  viewport: { width: number; height: number },
): GlobeTour {
  if (!stops.length) throw new RangeError("A globe tour needs at least one place.");
  const primary = stops[0].coordinates;
  let secondary = primary, greatestDistance = -1;
  const primaryLatitude = primary[1] * Math.PI / 180;
  for (const stop of stops.slice(1)) {
    const latitude = stop.coordinates[1] * Math.PI / 180;
    const longitudeDelta = (stop.coordinates[0] - primary[0]) * Math.PI / 180;
    const distance = Math.sin((latitude - primaryLatitude) / 2) ** 2 +
      Math.cos(primaryLatitude) * Math.cos(latitude) * Math.sin(longitudeDelta / 2) ** 2;
    if (distance > greatestDistance) { secondary = stop.coordinates; greatestDistance = distance; }
  }
  const overviewZoom = viewport.height > viewport.width ? 1.35 : viewport.width > viewport.height ? 1.05 : 0.8;
  // At 4.25+ the real region layers are fully visible. Stay within the archive's
  // global z0–6 coverage, well below the city/street-level extract windows.
  const regionZoom = viewport.width === viewport.height ? 4.75 : 5;
  const primaryWide: CameraState = { center: primary, zoom: overviewZoom };
  const primaryRegion: CameraState = { center: primary, zoom: regionZoom };
  const primaryTravel: CameraState = { center: primary, zoom: 2.25 };
  const secondaryTravel: CameraState = { center: secondary, zoom: 2.25 };
  const secondaryRegion: CameraState = { center: secondary, zoom: regionZoom };
  return {
    overviewZoom, regionZoom, posterFrame: 202,
    keyframes: [
      { frame: 0, camera: { center: [primary[0] - 18, primary[1]], zoom: overviewZoom } },
      { frame: 59, camera: primaryWide },
      { frame: 179, camera: primaryRegion },
      { frame: 224, camera: primaryRegion },
      { frame: 314, camera: primaryTravel },
      { frame: 434, camera: secondaryTravel },
      { frame: 539, camera: secondaryRegion },
      { frame: 584, camera: secondaryRegion },
      { frame: 719, camera: { center: secondary, zoom: overviewZoom } },
    ],
  };
}

export function cameraAtFrame(frame: number, tour: GlobeTour): CameraState {
  if (!Number.isInteger(frame) || frame < 0 || frame >= 720)
    throw new RangeError("Frame must be an integer from 0 through 719.");
  const keys = tour.keyframes;
  if (frame === 0) return keys[0].camera;
  let index = 1;
  while (frame > keys[index].frame) index++;
  if (frame === keys[index].frame) return keys[index].camera;
  const from = keys[index - 1], to = keys[index];
  if (from.camera === to.camera) return from.camera;
  const t = (frame - from.frame) / (to.frame - from.frame);
  // Minimum-jerk easing: velocity AND acceleration reach zero at every join.
  // Separate pan and dolly shots prevent sideways drift during regional dives.
  const s = t * t * t * (t * (t * 6 - 15) + 10);
  const a = from.camera.center, b = to.camera.center;
  const longitudeDelta = ((b[0] - a[0] + 180) % 360 + 360) % 360 - 180;
  return {
    center: a[0] === b[0] && a[1] === b[1] ? a :
      [a[0] + longitudeDelta * s, a[1] + (b[1] - a[1]) * s],
    zoom: from.camera.zoom + (to.camera.zoom - from.camera.zoom) * s,
  };
}
