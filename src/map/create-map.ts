// Served unbundled beside its shared chunk and worker (vite.config.ts), so the
// worker is found next to the library and the shared chunk ships once.
import * as maplibregl from "maplibre-gl";
import type {
  Map as LibreMap,
  StyleSpecification,
  GeoJSONSourceSpecification,
  LngLatBoundsLike,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { PMTiles, Protocol } from "pmtiles";
import { archiveSource } from "./archive";
import styleUrl from "../generated/style.json?url";
import countriesFineUrl from "../generated/countries-fine.geojson?url";
import regionsFineUrl from "../generated/regions-fine.geojson?url";
import { activeLayer } from "./layers";
import {
  homes,
  isMissingTile,
  places,
  trips,
  visits,
  visitsByPlace,
} from "./data";
export * from "./data";
import { apartKm } from "./expressions";
import { visibleAt, type Dated } from "./time";
import { cameraAtFrame, createGlobeTour, selectTourStops, tourCandidates } from "./tour";
import { attachSky } from "./sky";
import type { Theme } from "../theme";
import { isOpeningView, type Action, type AtlasState, type Timeline } from "../state/atlas-state";
import type { Store } from "../state/store";
// The archive holds z7–14 only in padded windows around places. An empty tile
// (or a 404, which MapLibre treats the same) renders as a blank hole; an errored
// tile makes MapLibre draw the nearest ancestor it has, at worst the global z6.
const protocol = new Protocol({ errorOnMissingTile: true });
maplibregl.addProtocol("pmtiles", protocol.tile);
const base = new URL(import.meta.env.BASE_URL, location.href);
const archive =
  import.meta.env.VITE_BASEMAP !== "bundled" && import.meta.env.VITE_BASEMAP_URL
    ? import.meta.env.VITE_BASEMAP_URL
    : new URL("tiles/basemap.pmtiles", base).href;
// Start what the first frame waits on while the style downloads: the worker
// pool and the archive's header and root directory, which the tile requests share.
maplibregl.prewarm();
const archiveTiles = new PMTiles(archiveSource(archive));
protocol.add(archiveTiles);
archiveTiles.getHeader().catch(() => {
  // The map awaits this same request and reports a failure itself.
});
const ease = (t: number) => t * t * (3 - 2 * t);
/**
 * The map's handle. What the map lights, filters and flies to follows the
 * store; the handle adds only what is not state (the camera nudge, teardown)
 * and, for verification and the recorder, shorthands that dispatch actions.
 */
export type Atlas = {
  map: LibreMap;
  firstIdleMs: number;
  /** The basemap archive URL and whether it is served from this origin. */
  archive: { url: string; bundled: boolean };
  select: (id: string) => void;
  reset: () => void;
  zoomBy: (delta: number) => void;
  destroy: () => void;
};
declare global {
  interface Window {
    __atlas?: Atlas;
  }
}
export async function createMap(
  container: HTMLElement,
  store: Store,
  onView: (message: string, zoom: number, visibleIds: string[]) => void,
  signal: AbortSignal,
): Promise<Atlas> {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const deterministic =
    new URLSearchParams(location.search).get("deterministic") === "1";
  // index.html preloads the style, so this request is usually already answered.
  const response = await fetch(styleUrl, { signal });
  if (!response.ok)
    // The URL and status let the page recognise a build removed by a deploy.
    throw Object.assign(new Error(`Style ${styleUrl}: HTTP ${response.status}`), {
      url: new URL(styleUrl, location.href).href,
      status: response.status,
    });
  const style = (await response.json()) as StyleSpecification;
  for (const source of Object.values(style.sources))
    if (source.type === "vector") source.url = "pmtiles://" + archive;
  style.glyphs = new URL("glyphs/{fontstack}/{range}.pbf", base).href
    .replaceAll("%7B", "{")
    .replaceAll("%7D", "}");
  style.sprite = new URL("sprites/dark", base).href;
  if (media.matches || deterministic)
    style.transition = { duration: 0, delay: 0 };
  // The first frame already wears the theme the page booted with.
  const initialTheme = store.getState().theme;
  style.state = { theme: { default: initialTheme } };
  const home = { center: [10, 35] as [number, number], zoom: innerWidth < 700 ? 0.65 : 1.8 };
  const map = new maplibregl.Map({
    container,
    style,
    center: home.center,
    zoom: home.zoom,
    minZoom: 0.5,
    maxZoom: 16,
    maxPitch: 0,
    dragRotate: false,
    touchPitch: false,
    attributionControl: false,
    // The build validates the style; skipping it here saves main-thread time.
    validateStyle: false,
    // Multisampling pays off on standard screens; dense ones barely show the
    // edges it smooths, and above 2x the extra pixels cost more than they show.
    pixelRatio: Math.min(devicePixelRatio || 1, 2),
    canvasContextAttributes: { antialias: (devicePixelRatio || 1) < 2 },
    fadeDuration: media.matches || deterministic ? 0 : 200,
  });
  const sky = attachSky(map, initialTheme, () => media.matches);
  // Global state can only change once the style has loaded; until then the
  // latest choice waits and is applied on arrival.
  let theme = initialTheme;
  let styled = false;
  map.once("style.load", () => {
    styled = true;
    if (theme !== initialTheme) map.setGlobalStateProperty("theme", theme);
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // MapLibre climbs one ancestor per source update, and an errored tile does
  // not schedule one. Keep climbing until a tile with data covers the hole.
  map.on("error", (event) => {
    if (isMissingTile(event.error)) map._update();
  });
  const canvas = map.getCanvas();
  canvas.setAttribute(
    "aria-label",
    "World map. Use arrow keys to pan, plus and minus to zoom, or Browse places. Alt+W returns to the world.",
  );
  canvas.tabIndex = 0;
  /**
   * Once the viewer has moved the camera, each settled camera is reported to
   * the store; ignition and the flight home after a reset never are.
   */
  const reportCamera = () => {
    if (!stopped) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    const atHome =
      Math.abs(zoom - home.zoom) < 0.01 &&
      Math.abs(center.lat - home.center[1]) < 0.01 &&
      Math.abs(center.lng - home.center[0]) < 0.01;
    store.dispatch({
      type: "moved",
      camera: atHome ? { kind: "home" } : { kind: "moved", zoom, lat: center.lat, lng: center.lng },
    });
  };
  let animation = 0;
  let touring = false;
  /** The tour's opening flight is under way; a viewer's gesture already ends it. */
  let tourFlight = false;
  let tourFrame = 0;
  let tourTimer = 0;
  let igniting = false;
  let stopped = false;
  let filtering = 0;
  const countrySource = style.sources.countries as GeoJSONSourceSpecification;
  const regionSource = style.sources.regions as GeoJSONSourceSpecification;
  const countries = countrySource.data as FeatureCollection;
  const regions = regionSource.data as FeatureCollection;
  const states = new Map<string, number>();
  // Boundaries outside a focused journey recede; tracked like visibility so a
  // fine-geometry swap re-applies them.
  const dims = new Map<string, number>();
  // Progressive geometry: fine boundary LODs load once the viewer zooms past
  // the band where their detail is visible, then the tracked feature state is
  // re-applied so a swap can never relight a filtered-out boundary.
  const fineLoaded = new Set<string>();
  const fineSources: Record<string, { url: string; zoom: number }> = {
    regions: { url: regionsFineUrl, zoom: 3 },
    countries: { url: countriesFineUrl, zoom: 4.5 },
  };
  const loadFine = (id: string) => {
    if (fineLoaded.has(id)) return;
    const source = map.getSource(id);
    if (!source || !("setData" in source)) return;
    fineLoaded.add(id);
    (source as maplibregl.GeoJSONSource).setData(
      new URL(fineSources[id].url, location.href).href,
    );
    map.once("idle", () => {
      for (const [key, visibility] of states)
        if (key.startsWith(id))
          map.setFeatureState(
            { source: id, id: key.slice(id.length) },
            { visibility },
          );
      for (const [key, dim] of dims)
        if (key.startsWith(id))
          map.setFeatureState({ source: id, id: key.slice(id.length) }, { dim });
    });
  };
  const refineForZoom = () => {
    const z = map.getZoom();
    for (const [id, fine] of Object.entries(fineSources))
      if (z >= fine.zoom) loadFine(id);
  };
  const features = [
    ...countries.features.map((f) => ({
      source: "countries",
      id: String(f.id),
      visits: visits.filter((v) => v.country === f.properties?.country),
    })),
    ...regions.features.map((f) => ({
      source: "regions",
      id: String(f.id),
      visits: visits.filter((v) => v.region === f.properties?.region),
    })),
    ...places.map((p) => ({
      source: "pins",
      id: p.id,
      visits: visitsByPlace.get(p.id) ?? [],
    })),
    // Home is lit for the period it was home.
    ...homes.map((home) => ({
      source: "home",
      id: home.id,
      visits: [{ dateRange: [home.since ?? "", home.until ?? ""] }] as Dated[],
    })),
    // Label anchors follow their boundary's visibility.
    ...countries.features.map((f) => ({
      source: "anchors",
      id: String(f.id),
      visits: visits.filter((v) => v.country === f.properties?.country),
    })),
    ...regions.features.map((f) => ({
      source: "anchors",
      id: String(f.id),
      visits: visits.filter((v) => v.region === f.properties?.region),
    })),
  ];
  const finishIgnition = () => {
    if (!igniting) return;
    igniting = false;
    cancelAnimationFrame(animation);
    for (const feature of countries.features) {
      states.set("countries" + feature.id, 1);
      map.setFeatureState({ source: "countries", id: feature.id! }, { visibility: 1 });
    }
  };
  // Journeys stay off the map until one is in focus: a selected stop, a
  // journey chosen in the directory, or a hovered directory entry. The focused
  // group's arcs and numbered stars reveal in travel order; other pins recede.
  const routeData = (style.sources.routes as GeoJSONSourceSpecification)
    .data as FeatureCollection;
  const stopData = (style.sources.stops as GeoJSONSourceSpecification)
    .data as FeatureCollection;
  const satelliteData = (style.sources.satellites as GeoJSONSourceSpecification)
    .data as FeatureCollection;
  const waypointData = (style.sources.waypoints as GeoJSONSourceSpecification)
    .data as FeatureCollection;
  const segmentsByGroup = new Map<string, string[]>();
  // The outbound lens arc of each day trip, by group and place, for its satellite's cue.
  const excursionIndex = new Map<string, number>();
  // The arc arriving at each stop on the way, by group and place, for its mark's cue.
  const waypointIndex = new Map<string, number>();
  // The arcs arriving at a stop or at home, in order: a hop through places on
  // the way is several arcs, so the n-th stop lights with the n-th arrival.
  const arrivalsByGroup = new Map<string, number[]>();
  for (const feature of [...routeData.features].sort(
    (a, b) => Number(a.properties?.order) - Number(b.properties?.order),
  )) {
    const group = String(feature.properties?.group);
    const segments = segmentsByGroup.get(group) ?? [];
    if (feature.properties?.kind === "excursion") {
      const key = `${group}#${String(feature.properties.place)}`;
      if (!excursionIndex.has(key)) excursionIndex.set(key, segments.length);
    } else if (feature.properties?.place) {
      const key = `${group}#${String(feature.properties.place)}`;
      if (!waypointIndex.has(key)) waypointIndex.set(key, segments.length);
    } else {
      arrivalsByGroup.set(group, [...(arrivalsByGroup.get(group) ?? []), segments.length]);
    }
    segmentsByGroup.set(group, [...segments, String(feature.id)]);
  }
  const waypointsByGroup = new Map<string, { id: string; place: string }[]>();
  const waypointGroups = new Map<string, string[]>();
  for (const feature of waypointData.features) {
    const group = String(feature.properties?.group);
    const place = String(feature.properties?.place);
    waypointsByGroup.set(group, [
      ...(waypointsByGroup.get(group) ?? []),
      { id: String(feature.id), place },
    ]);
    waypointGroups.set(place, [...(waypointGroups.get(place) ?? []), group]);
  }
  const satellitesByGroup = new Map<string, { id: string; place: string }[]>();
  const satelliteGroups = new Map<string, string[]>();
  for (const feature of satelliteData.features) {
    const group = String(feature.properties?.group);
    const place = String(feature.properties?.place);
    satellitesByGroup.set(group, [
      ...(satellitesByGroup.get(group) ?? []),
      { id: String(feature.id), place },
    ]);
    satelliteGroups.set(place, [...(satelliteGroups.get(place) ?? []), group]);
  }
  const stopsByGroup = new Map<string, { id: string; place: string; first: number }[]>();
  for (const feature of stopData.features) {
    const group = String(feature.properties?.group);
    stopsByGroup.set(group, [
      ...(stopsByGroup.get(group) ?? []),
      {
        id: String(feature.id),
        place: String(feature.properties?.place),
        first: Number(String(feature.properties?.n).split("·")[0]),
      },
    ]);
  }
  const boundaries = [
    ...countries.features.map((f) => ({ source: "countries", id: String(f.id) })),
    ...regions.features.map((f) => ({ source: "regions", id: String(f.id) })),
  ];
  // A stop lights its journey; a lone stay its own lens; a day trip its base's
  // group; a place passed on the way the group of the route through it.
  const groupForPlace = (id: string): string | null =>
    trips.find((trip) => trip.stops.includes(id))?.id ??
    (segmentsByGroup.has(`place:${id}`) ? `place:${id}` : null) ??
    satelliteGroups.get(id)?.[0] ??
    waypointGroups.get(id)?.[0] ??
    null;
  const membersOf = (group: string): string[] => [
    ...(group.startsWith("place:")
      ? [group.slice("place:".length)]
      : (trips.find((trip) => trip.id === group)?.stops ?? [])),
    ...(satellitesByGroup.get(group) ?? []).map((satellite) => satellite.place),
    ...(waypointsByGroup.get(group) ?? []).map((waypoint) => waypoint.place),
  ];
  let shownFocus: string | null = null;
  let currentStop: string | null = null;
  let revealFrame = 0;
  const revealDuration = 420;
  const revealEntries = (group: string) => {
    const segments = segmentsByGroup.get(group) ?? [];
    const leadIn = trips.find((trip) => trip.id === group)?.from ? 1 : 0;
    const arrivals = arrivalsByGroup.get(group) ?? [];
    const stagger = Math.min(220, 1500 / Math.max(1, segments.length));
    return [
      ...segments.map((id, index) => ({ source: "routes", id, at: index * stagger })),
      // A star lights as the arc arriving at it finishes drawing.
      ...(stopsByGroup.get(group) ?? []).map((stop) => {
        const arriving = arrivals[stop.first - 2 + leadIn] ?? -1;
        return {
          source: "stops",
          id: stop.id,
          at: arriving < 0 ? 0 : arriving * stagger + revealDuration * 0.5,
        };
      }),
      // A mark on the way lights as the arc arriving at it finishes drawing.
      ...(waypointsByGroup.get(group) ?? []).map((waypoint) => ({
        source: "waypoints",
        id: waypoint.id,
        at: (waypointIndex.get(waypoint.id) ?? 0) * stagger + revealDuration * 0.5,
      })),
      // A day trip's ring follows its lens, after the route itself has drawn.
      ...(satellitesByGroup.get(group) ?? []).map((satellite) => ({
        source: "satellites",
        id: satellite.id,
        at: (excursionIndex.get(satellite.id) ?? segments.length) * stagger + revealDuration * 0.5,
      })),
    ];
  };
  // The selected place's star, day-trip ring or mark on the way takes the ink stroke.
  const markCurrent = (place: string | null) => {
    for (const source of ["stops", "satellites", "waypoints"]) {
      if (currentStop) map.setFeatureState({ source, id: currentStop }, { current: false });
    }
    currentStop = place && shownFocus ? `${shownFocus}#${place}` : null;
    if (currentStop)
      for (const source of ["stops", "satellites", "waypoints"])
        map.setFeatureState({ source, id: currentStop }, { current: true });
  };
  const settleFocus = () => {
    cancelAnimationFrame(revealFrame);
    if (!shownFocus || !map.getSource("routes")) return;
    for (const entry of revealEntries(shownFocus))
      map.setFeatureState({ source: entry.source, id: entry.id }, { reveal: 1 });
  };
  function showFocus(group: string | null, place: string | null = null) {
    if (!map.getSource("routes")) {
      map.once("style.load", () => showFocus(group, place));
      return;
    }
    if (group === shownFocus) {
      markCurrent(place);
      return;
    }
    cancelAnimationFrame(revealFrame);
    if (shownFocus)
      for (const entry of revealEntries(shownFocus))
        map.setFeatureState({ source: entry.source, id: entry.id }, { reveal: 0 });
    shownFocus = group;
    const match: maplibregl.FilterSpecification = ["==", ["get", "group"], group ?? ""];
    map.setFilter("journey-legs", ["all", ["==", ["get", "kind"], "leg"], match]);
    map.setFilter("journey-hops", ["all", ["==", ["get", "kind"], "hop"], match]);
    map.setFilter("journey-excursions", ["all", ["==", ["get", "kind"], "excursion"], match]);
    for (const layer of [
      "journey-stops",
      "journey-stop-numbers",
      "journey-stop-labels",
      "journey-daytrips",
      "journey-daytrip-labels",
      "journey-via",
      "journey-via-labels",
    ])
      map.setFilter(layer, match);
    const members = new Set(group ? membersOf(group) : []);
    for (const candidate of places)
      map.setFeatureState(
        { source: "pins", id: candidate.id },
        { dim: group && !members.has(candidate.id) ? 1 : 0 },
      );
    // Only the countries and regions the journey passes through stay lit.
    const related = new Set(
      places
        .filter((candidate) => members.has(candidate.id))
        .flatMap((candidate) => [candidate.country, candidate.region ?? ""]),
    );
    for (const boundary of boundaries) {
      const dim = group && !related.has(boundary.id) ? 1 : 0;
      dims.set(boundary.source + boundary.id, dim);
      map.setFeatureState({ source: boundary.source, id: boundary.id }, { dim });
      map.setFeatureState({ source: "anchors", id: boundary.id }, { dim });
    }
    markCurrent(place);
    if (!group) return;
    const entries = revealEntries(group);
    if (media.matches || deterministic) {
      settleFocus();
      return;
    }
    const start = performance.now();
    const frame = (now: number) => {
      let done = true;
      for (const entry of entries) {
        const t = Math.min(1, Math.max(0, (now - start - entry.at) / revealDuration));
        if (t < 1) done = false;
        map.setFeatureState({ source: entry.source, id: entry.id }, { reveal: ease(t) });
      }
      if (!done) revealFrame = requestAnimationFrame(frame);
    };
    revealFrame = requestAnimationFrame(frame);
  }
  const fly = (bounds: LngLatBoundsLike, maxZoom: number, clearance = 0) => {
    finishIgnition();
    stopped = true;
    const camera = map.cameraForBounds(bounds, {
      padding: {
        top: innerWidth > 700 ? 110 : 125,
        bottom: innerWidth > 700 ? 100 + clearance : 190,
        left: 40,
        right: 40,
      },
      maxZoom,
    });
    if (camera)
      map.flyTo({
        ...camera,
        pitch: 0,
        bearing: 0,
        speed: 0.72,
        curve: 1.5,
        easing: ease,
        animate: !media.matches,
      });
  };
  const flyToPlace = (id: string) => {
    const target = homes.find((candidate) => candidate.id === id) ?? places.find((place) => place.id === id);
    if (!target) return;
    const [x, y] = target.coordinates;
    fly(
      [
        [x - 0.035, y - 0.022],
        [x + 0.035, y + 0.022],
      ],
      11,
    );
  };
  const frameJourney = (id: string) => {
    const trip = trips.find((candidate) => candidate.id === id);
    if (!trip) return;
    // The frame includes home, so the whole round trip is in view.
    const points = [
      ...[...trip.stops, ...(trip.via ?? []).flat()].map(
        (stop) => places.find((place) => place.id === stop)?.coordinates,
      ),
      ...[trip.from, trip.to].map(
        (base) => homes.find((candidate) => candidate.id === base)?.coordinates,
      ),
    ].filter((point): point is [number, number] => Boolean(point));
    if (!points.length) return;
    fly(
      [
        [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
        [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
      ],
      6,
      // Clear of the timeline, so a journey's home is never framed beneath it.
      40,
    );
  };
  const flyHome = () => {
    finishIgnition();
    stopped = false;
    map.flyTo({
      center: home.center,
      zoom: home.zoom,
      bearing: 0,
      pitch: 0,
      speed: 0.72,
      curve: 1.5,
      easing: ease,
      animate: !media.matches,
    });
  };
  const jumpTo = (camera: { zoom: number; lat: number; lng: number }) => {
    finishIgnition();
    stopped = true;
    map.jumpTo({ center: [camera.lng, camera.lat], zoom: camera.zoom, bearing: 0, pitch: 0 });
  };
  const startTour = () => {
    // The recorder picks the same stops, so the movie and the app agree.
    const candidates = tourCandidates(places, homes);
    if (touring) return;
    if (!candidates.length) {
      store.dispatch({ type: "stopTour" });
      return;
    }
    const stops = selectTourStops(candidates, candidates[0]);
    const { width, height } = canvas.getBoundingClientRect();
    const tour = createGlobeTour(stops, { width, height });
    finishIgnition();
    for (const id of Object.keys(fineSources)) loadFine(id);
    touring = true;
    stopped = true;
    const apply = (camera: { center: [number, number]; zoom: number }) =>
      map.jumpTo({ center: camera.center, zoom: camera.zoom, bearing: 0, pitch: 0 });
    const end = () => store.dispatch({ type: "stopTour" });
    if (media.matches) {
      // Reduced motion: hold each shot instead of flying between them.
      let index = 0;
      const next = () => {
        if (!touring) return;
        if (index >= tour.keyframes.length) {
          end();
          return;
        }
        apply(tour.keyframes[index].camera);
        index += 1;
        tourTimer = window.setTimeout(next, 1500);
      };
      next();
      return;
    }
    // The tour begins where the viewer is: fly from the current camera to the
    // opening wide shot, as "World" does, then play the choreography onwards.
    const entry = tour.keyframes[1];
    const playFrom = (first: number) => {
      const start = performance.now();
      const frame = (now: number) => {
        if (!touring) return;
        // A frame timestamp can precede the performance.now() taken at start.
        const index = Math.max(first, Math.min(719, first + Math.floor(((now - start) / 1000) * 30)));
        apply(cameraAtFrame(index, tour));
        if (index >= 719) {
          end();
          return;
        }
        tourFrame = requestAnimationFrame(frame);
      };
      tourFrame = requestAnimationFrame(frame);
    };
    map.stop();
    map.once("moveend", () => {
      tourFlight = false;
      if (!touring) return;
      // Another camera move interrupted the flight: the viewer took over.
      const center = map.getCenter();
      const drift = Math.abs(((center.lng - entry.camera.center[0] + 540) % 360) - 180);
      if (
        drift > 0.01 ||
        Math.abs(center.lat - entry.camera.center[1]) > 0.01 ||
        Math.abs(map.getZoom() - entry.camera.zoom) > 0.01
      ) {
        end();
        return;
      }
      playFrom(entry.frame);
    });
    tourFlight = true;
    map.flyTo({
      center: entry.camera.center,
      zoom: entry.camera.zoom,
      bearing: 0,
      pitch: 0,
      speed: 0.72,
      curve: 1.5,
      easing: ease,
      essential: true,
    });
  };
  const endTour = () => {
    if (!touring) return;
    touring = false;
    // Ending the flight fires moveend, which reports the view once touring is off.
    if (tourFlight) map.stop();
    tourFlight = false;
    cancelAnimationFrame(tourFrame);
    clearTimeout(tourTimer);
    reportView();
    reportCamera();
  };
  const filter = ({ through, mode }: Timeline) => {
    igniting = false;
    cancelAnimationFrame(filtering);
    cancelAnimationFrame(animation);
    const start = performance.now();
    const values = features.map((f) => {
      const key = f.source + f.id;
      const target = Math.max(
        0,
        ...f.visits.map((v) => visibleAt(v, through, mode)),
      );
      return { ...f, key, from: states.get(key) ?? 1, target };
    });
    const frame = (now: number) => {
      const t =
        media.matches || deterministic ? 1 : Math.min(1, (now - start) / 240);
      for (const f of values) {
        const visibility = f.from + (f.target - f.from) * ease(t);
        states.set(f.key, visibility);
        map.setFeatureState({ source: f.source, id: f.id }, { visibility });
      }
      if (t < 1) filtering = requestAnimationFrame(frame);
    };
    filtering = requestAnimationFrame(frame);
  };
  const setTheme = (next: Theme) => {
    if (next === theme) return;
    theme = next;
    sky.setTheme(next);
    if (styled) map.setGlobalStateProperty("theme", next);
  };
  /** The journey a subject lights: its own, the one a stop belongs to, or none for a home. */
  const groupOf = (state: AtlasState): string | null => {
    const { subject } = state;
    if (subject.kind === "journey") return subject.id;
    if (subject.kind === "place" && !homes.some((candidate) => candidate.id === subject.id))
      return groupForPlace(subject.id);
    return null;
  };
  const isHome = (id: string) => homes.some((candidate) => candidate.id === id);
  /**
   * Brings the map in line with the state. Lighting, filter, theme and tour
   * follow the state itself; the camera follows only the actions that ask to
   * go somewhere, so a camera the viewer moved is never pulled back.
   */
  let applied: AtlasState | null = null;
  const apply = (state: AtlasState, action: Action | null) => {
    const previous = applied;
    applied = state;
    if (previous ? previous.timeline !== state.timeline : state.timeline.through !== null || state.timeline.mode !== "cumulative")
      filter(state.timeline);
    setTheme(state.theme);
    if (previous?.touring && !state.touring) endTour();
    const place = state.subject.kind === "place" && !isHome(state.subject.id) ? state.subject.id : null;
    showFocus(state.preview ?? groupOf(state), place);
    const subject = state.subject;
    const arrived = !previous || previous.subject.kind !== subject.kind ||
      (subject.kind !== "none" && (previous.subject as typeof subject).id !== subject.id);
    switch (action?.type ?? "route") {
      case "select":
        if (subject.kind === "place") flyToPlace(subject.id);
        break;
      case "focusJourney":
        if (subject.kind === "journey") frameJourney(subject.id);
        break;
      case "reset":
        flyHome();
        break;
      case "route":
        if (subject.kind === "place" && arrived) flyToPlace(subject.id);
        else if (subject.kind === "journey" && arrived) frameJourney(subject.id);
        else if (subject.kind === "none" && state.camera.kind === "moved" && (!previous || previous.camera !== state.camera))
          jumpTo(state.camera);
        break;
    }
    if (state.touring && !previous?.touring) startTour();
  };
  const unsubscribe = store.subscribe((state, _previous, action) => {
    if (styled) apply(state, action);
  });
  const atlas: Atlas = {
    map,
    firstIdleMs: 0,
    archive: { url: archive, bundled: new URL(archive).origin === location.origin },
    select: (id) => store.dispatch({ type: "select", id }),
    reset: () => store.dispatch({ type: "reset" }),
    zoomBy(delta) {
      finishIgnition();
      stopped = true;
      map.easeTo({
        zoom: map.getZoom() + delta,
        duration: media.matches ? 0 : 320,
        easing: ease,
      });
    },
    destroy() {
      unsubscribe();
      sky.destroy();
      touring = false;
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(tourFrame);
      clearTimeout(tourTimer);
      cancelAnimationFrame(animation);
      cancelAnimationFrame(filtering);
      media.removeEventListener("change", motionChanged);
      map.remove();
      delete window.__atlas;
    },
  };
  function motionChanged() {
    if (media.matches) {
      finishIgnition();
      settleFocus();
      cancelAnimationFrame(animation);
      cancelAnimationFrame(filtering);
      map.stop();
      for (const f of features)
        map.setFeatureState(
          { source: f.source, id: f.id },
          { visibility: states.get(f.source + f.id) ?? 1 },
        );
    }
  }
  media.addEventListener("change", motionChanged);
  map.once("idle", () => {
    atlas.firstIdleMs = performance.now();
  });
  // Boundaries, pins and routes are inline GeoJSON, so the atlas can light up
  // as soon as the style is ready rather than after every basemap tile arrives.
  map.once("style.load", () => {
    apply(store.getState(), null);
    reportView();
    // Deterministic captures compare fine geometry regardless of camera history.
    if (deterministic) for (const id of Object.keys(fineSources)) loadFine(id);
    refineForZoom();
    if (!media.matches && !deterministic && isOpeningView(store.getState()) && !stopped) {
      igniting = true;
      for (const f of countries.features) {
        states.set("countries" + f.id, 0);
        map.setFeatureState({ source: "countries", id: f.id! }, { visibility: 0 });
      }
      const ordered = [...countries.features].sort((a, b) => {
        const first = (id: unknown) =>
          visits
            .filter((v) => v.country === id)
            .map((v) => v.date ?? v.dateRange?.[0] ?? "9999")
            .sort()[0] ?? "9999";
        return first(a.id).localeCompare(first(b.id));
      });
      // However many countries there are, the last one lights within two seconds.
      const stagger = Math.min(260, 1300 / Math.max(1, ordered.length - 1));
      const start = performance.now();
      const ignite = (now: number) => {
        let done = true;
        ordered.forEach((f, i) => {
          const visibility = Math.min(
            1,
            Math.max(0, (now - start - i * stagger) / 700),
          );
          if (visibility < 1) done = false;
          map.setFeatureState({ source: "countries", id: f.id! }, { visibility });
          states.set("countries" + f.id, visibility);
        });
        if (!done) animation = requestAnimationFrame(ignite);
        else igniting = false;
      };
      animation = requestAnimationFrame(ignite);
    }
  });
  map.on("movestart", (event) => {
    if (event.originalEvent) {
      // The gesture has already interrupted any flight; stopping the map again
      // would cancel the gesture itself.
      tourFlight = false;
      store.dispatch({ type: "stopTour" });
      finishIgnition();
      stopped = true;
      cancelAnimationFrame(animation);
      for (const f of features)
        map.setFeatureState(
          { source: f.source, id: f.id },
          { visibility: states.get(f.source + f.id) ?? 1 },
        );
    }
  });
  function reportView() {
    const { width, height } = canvas.getBoundingClientRect();
    const visibleIds = places.filter((place) => {
      const point = map.project(place.coordinates);
      if (point.x < 0 || point.y < 0 || point.x > width || point.y > height)
        return false;
      // A rear-hemisphere point can project inside the globe. A round trip
      // must return the same location, not its visible-side counterpart.
      const location = map.unproject(point);
      const longitude = ((location.lng - place.coordinates[0] + 540) % 360) - 180;
      return Math.abs(longitude) < 0.001 &&
        Math.abs(location.lat - place.coordinates[1]) < 0.001;
    }).map((place) => place.id);
    const z = map.getZoom();
    onView(
      z < 3.5
        ? "The world, with visited countries illuminated."
        : z < 6.5
          ? "Exploring visited regions."
          : "Exploring places. Select a light or browse places in view.",
      z,
      visibleIds,
    );
  }
  map.on("moveend", () => {
    // A playing tour moves every frame; the view report and URL wait for it to end.
    if (touring) return;
    reportView();
    reportCamera();
  });
  map.on("zoomend", refineForZoom);
  map.on("resize", reportView);
  let hovered: { source: string; id: string | number } | undefined;
  const unhover = () => {
    if (hovered) map.setFeatureState(hovered, { hover: false });
    hovered = undefined;
    canvas.style.cursor = "";
  };
  // Only the band's pointer target responds, so a region under the cursor does
  // not light while the viewer is still choosing a country. Pins answer from
  // the general pointer handlers below, which give them a tolerant reach.
  for (const source of ["countries", "regions"] as const) {
    map.on("mousemove", source, (event) => {
      if (activeLayer(map.getZoom()) !== source) {
        if (hovered?.source === source) unhover();
        return;
      }
      const id = event.features?.[0]?.id;
      if (id === undefined) return;
      if (hovered && (hovered.source !== source || hovered.id !== id))
        map.setFeatureState(hovered, { hover: false });
      hovered = { source, id };
      map.setFeatureState(hovered, { hover: true });
      canvas.style.cursor = "pointer";
    });
    map.on("mouseleave", source, () => {
      if (hovered?.source === source) unhover();
    });
  }
  map.on("zoomend", () => {
    if (hovered && activeLayer(map.getZoom()) !== hovered.source) unhover();
  });
  // A pin is a few pixels wide and a fingertip is not: a tap reaches the
  // nearest mark within a thumb's radius, and a place's label answers as well.
  const coarse = matchMedia("(pointer: coarse)");
  const reachOf = (event: maplibregl.MapMouseEvent) => {
    const type = (event.originalEvent as PointerEvent).pointerType;
    return type === "touch" || (!type && coarse.matches) ? 24 : 8;
  };
  type Hit = { feature: maplibregl.MapGeoJSONFeature; distance: number };
  const nearest = (
    point: maplibregl.Point,
    layers: string[],
    reach: number,
    accept: (feature: maplibregl.MapGeoJSONFeature) => boolean = () => true,
  ): Hit | undefined => {
    let best: Hit | undefined;
    for (const feature of map.queryRenderedFeatures(
      [
        [point.x - reach, point.y - reach],
        [point.x + reach, point.y + reach],
      ],
      { layers },
    )) {
      if (feature.geometry.type !== "Point" || !accept(feature)) continue;
      const distance = map
        .project(feature.geometry.coordinates as [number, number])
        .dist(point);
      // A label's anchor sits beside its text, so a label hit counts as in reach.
      const effective = feature.layer.type === "symbol" ? Math.min(distance, reach) : distance;
      if (effective <= reach && (!best || effective < best.distance))
        best = { feature, distance: effective };
    }
    return best;
  };
  // Home answers at any zoom where its ring is drawn.
  const homeAt = (point: maplibregl.Point, reach = 6) =>
    map.getZoom() < 3
      ? undefined
      : nearest(point, ["home-ring"], reach, (feature) =>
          (states.get("home" + String(feature.id)) ?? 1) > 0.5);
  const pinAt = (point: maplibregl.Point, reach: number) =>
    activeLayer(map.getZoom()) === "pins"
      ? nearest(point, ["pins", "place-labels"], reach, (feature) =>
          (states.get("pins" + String(feature.id)) ?? 1) > 0.5)
      : undefined;
  // A focused journey's numbered stars, day-trip rings and marks on the way
  // answer wherever they are drawn.
  const stopAt = (point: maplibregl.Point, reach: number) =>
    shownFocus && map.getZoom() >= 2
      ? nearest(
          point,
          [
            "journey-stops",
            "journey-stop-labels",
            "journey-daytrips",
            "journey-daytrip-labels",
            "journey-via",
            "journey-via-labels",
          ],
          reach,
          // A ring or mark still hidden beneath a star must not catch the star's tap.
          (feature) =>
            feature.properties.km === undefined ||
            Number(feature.properties.km) >= apartKm(map.getZoom()),
        )
      : undefined;
  /** The closest home, journey stop or pin to the pointer, as a place or home ID. */
  const markAt = (point: maplibregl.Point, reach: number): string | undefined => {
    const home = homeAt(point, reach);
    const stop = stopAt(point, reach);
    const pin = pinAt(point, reach);
    const [closest] = [
      home && { id: home.feature.id, distance: home.distance },
      stop && { id: stop.feature.properties.place, distance: stop.distance },
      pin && { id: pin.feature.id, distance: pin.distance },
    ]
      .filter((hit) => hit !== undefined)
      .sort((a, b) => a.distance - b.distance);
    return closest ? String(closest.id) : undefined;
  };
  map.on("mousemove", (event) => {
    const pin = pinAt(event.point, 8)?.feature;
    if (pin?.id !== undefined) {
      if (hovered && (hovered.source !== "pins" || hovered.id !== pin.id))
        map.setFeatureState(hovered, { hover: false });
      hovered = { source: "pins", id: pin.id };
      map.setFeatureState(hovered, { hover: true });
    } else if (hovered?.source === "pins") unhover();
    if (pin || homeAt(event.point) || stopAt(event.point, 8)) canvas.style.cursor = "pointer";
    else if (!hovered) canvas.style.cursor = "";
  });
  map.on("mouseout", () => {
    if (hovered?.source === "pins") unhover();
  });
  map.on("click", (event) => {
    const mark = markAt(event.point, reachOf(event));
    if (mark) {
      store.dispatch({ type: "select", id: mark });
      return;
    }
    const layer = activeLayer(map.getZoom());
    const feature =
      layer === "pins"
        ? undefined
        : map.queryRenderedFeatures(event.point, { layers: [layer] })[0];
    if (feature) {
      const raw = feature.properties.bbox;
      const bbox = (typeof raw === "string" ? JSON.parse(raw) : raw) as [
        number,
        number,
        number,
        number,
      ];
      if (bbox)
        fly(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          layer === "countries" ? 5.5 : 8,
        );
    } else {
      // Empty sea lets go of a place or a journey alike.
      store.dispatch({ type: "deselect" });
    }
  });
  window.__atlas = atlas;
  return atlas;
}
