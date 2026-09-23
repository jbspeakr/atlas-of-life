import { expect, it } from "vitest";
import { cameraAtFrame, createGlobeTour, selectTourStops } from "../scripts/recording.ts";
import type { GlobeTour, TourPlace } from "../scripts/recording.ts";

const places: TourPlace[] = [
  { id: "berlin", label: "Berlin", country: "DE", coordinates: [13.4, 52.5] },
  { id: "near-berlin", label: "Nearby entry", country: "DE", coordinates: [14, 52.2] },
  { id: "athens", label: "Athens", country: "GR", coordinates: [23.7, 38] },
  { id: "oslo", label: "Oslo", country: "NO", coordinates: [10.7, 59.9] },
  { id: "paris", label: "Paris", country: "FR", coordinates: [2.3, 48.8] },
];
const stops = selectTourStops(places, places[0]);
const tour = createGlobeTour(stops, { width: 540, height: 960 });

it("showcases diverse public entries instead of repeating one cluster", () => {
  expect(stops.map((stop) => stop.id).sort()).toEqual(["athens", "berlin", "oslo", "paris"]);
  expect(stops[0].id).toBe("berlin");
  expect(selectTourStops(places, places[2])[0].id).toBe("athens");
});

it("measures route diversity across the dateline, not a flat longitude range", () => {
  const datelinePlaces: TourPlace[] = [179, -179, 0, 90, -90].map((longitude) => ({
    id: String(longitude), label: String(longitude), country: "same-country", coordinates: [longitude, 0],
  }));
  expect(selectTourStops(datelinePlaces, datelinePlaces[0]).map((stop) => stop.id).sort())
    .toEqual(["-90", "0", "179", "90"]);
});

it("supports a one-entry atlas without inventing another region", () => {
  const only = selectTourStops([places[0]], places[0]);
  expect(only).toEqual([places[0]]);
  const single = createGlobeTour(only, { width: 540, height: 540 });
  expect(cameraAtFrame(202, single).center).toEqual(only[0].coordinates);
  expect(cameraAtFrame(562, single).center).toEqual(only[0].coordinates);
  expect(cameraAtFrame(719, single).center).toEqual(only[0].coordinates);
  expect(() => createGlobeTour([], { width: 540, height: 540 })).toThrow(RangeError);
  expect(() => selectTourStops([], places[0])).toThrow(RangeError);
});

it.each([59, 179, 224, 314, 434, 539, 584])("settles velocity and acceleration at shot boundary %i", (frame) => {
  const samples = [frame - 1, frame, frame + 1].map((index) => {
    const camera = cameraAtFrame(index, tour);
    return [...camera.center, camera.zoom];
  });
  for (let axis = 0; axis < 3; axis++) {
    const [before, at, after] = samples.map((sample) => sample[axis]);
    expect(Math.abs((after - before) / 2)).toBeLessThan(0.001);
    expect(Math.abs(after - 2 * at + before)).toBeLessThan(0.001);
  }
});

it.each([
  { width: 540, height: 960 }, { width: 540, height: 540 }, { width: 960, height: 540 },
])("reveals two regions without street-level zoom or sideways drift: %j", (viewport) => {
  const responsive = createGlobeTour(stops, viewport);
  const samples = Array.from({ length: 720 }, (_, frame) => cameraAtFrame(frame, responsive));
  expect(samples[202].center).toEqual(places[0].coordinates);
  expect(samples[562].center).toEqual(places[2].coordinates);
  expect(samples[202].zoom).toBeGreaterThanOrEqual(4.25);
  expect(samples[562].zoom).toBeGreaterThanOrEqual(4.25);
  expect(samples.every((sample) => Number.isFinite(sample.zoom) && sample.zoom >= 0.5 && sample.zoom <= 5)).toBe(true);
  for (let frame = 1; frame < samples.length; frame++) {
    const a = samples[frame - 1], b = samples[frame];
    if (b.center[0] !== a.center[0] || b.center[1] !== a.center[1]) {
      expect(a.zoom).toBeLessThanOrEqual(2.25);
      expect(b.zoom).toBeLessThanOrEqual(2.25);
      expect(b.zoom).toBe(a.zoom);
    }
  }
  for (const [first, last] of [[179, 224], [539, 584]])
    for (let frame = first; frame <= last; frame++) expect(samples[frame]).toEqual(samples[first]);
  expect(samples[719].center).toEqual(samples[562].center);
  expect(samples[719].zoom).toBe(samples[0].zoom);
});

it("makes one monotonic regional transfer, without course corrections or a forced reverse sweep", () => {
  const first = cameraAtFrame(314, tour), last = cameraAtFrame(434, tour);
  for (let frame = 315; frame <= 434; frame++) {
    const previous = cameraAtFrame(frame - 1, tour), current = cameraAtFrame(frame, tour);
    for (let axis = 0; axis < 2; axis++) {
      const direction = Math.sign(last.center[axis] - first.center[axis]);
      expect((current.center[axis] - previous.center[axis]) * direction).toBeGreaterThanOrEqual(0);
      expect(current.center[axis]).toBeGreaterThanOrEqual(Math.min(first.center[axis], last.center[axis]));
      expect(current.center[axis]).toBeLessThanOrEqual(Math.max(first.center[axis], last.center[axis]));
    }
  }
  for (let frame = 435; frame < 720; frame++)
    expect(cameraAtFrame(frame, tour).center).toEqual(last.center);
});

it("crosses the dateline on the short arc with eased motion", () => {
  const dateline: GlobeTour = { ...tour, keyframes: [
    { frame: 0, camera: { center: [179, 0], zoom: 2 } },
    { frame: 144, camera: { center: [-179, 10], zoom: 2 } },
    { frame: 719, camera: { center: [-179, 10], zoom: 2 } },
  ] };
  expect(cameraAtFrame(72, dateline).center).toEqual([180, 5]);
  expect(cameraAtFrame(143, dateline).center[0]).toBeGreaterThan(180.9);
  expect(cameraAtFrame(144, dateline).center[0]).toBe(-179);
});

it.each([-1, 0.5, 720, NaN, Infinity])("rejects invalid frame %s", (frame) => {
  expect(() => cameraAtFrame(frame, tour)).toThrow(RangeError);
});
