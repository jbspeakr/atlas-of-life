import maplibregl from "maplibre-gl";
import type {
  Map as LibreMap,
  StyleSpecification,
  GeoJSONSourceSpecification,
  LngLatBoundsLike,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { Protocol } from "pmtiles";
import styleUrl from "../generated/style.json?url";
import countriesFineUrl from "../generated/countries-fine.geojson?url";
import regionsFineUrl from "../generated/regions-fine.geojson?url";
import placesData from "../generated/places.json";
import visitsData from "../generated/visits.json";
import tripsData from "../generated/trips.json";
import homeData from "../generated/home.json";
import { placeKey } from "./place-key";
import { activeLayer } from "./layers";
import { visibleAt, type Dated, type TimeMode } from "./time";
import { formatHash, parseHash } from "./router";
import { cameraAtFrame, createGlobeTour, selectTourStops } from "./tour";
import { attachSky } from "./sky";
import { currentTheme, type Theme } from "../theme";
export type Place = {
  id: string;
  label: string;
  country: string;
  region?: string;
  city?: string;
  coordinates: [number, number];
  date?: string;
  dateRange?: [string, string];
  visitCount: number;
};
type PublicVisit = Omit<Place, "visitCount"> & { visitCount?: number };
export type Trip = {
  id: string;
  label: string;
  start: string;
  end: string;
  stops: string[];
  /** Home IDs the journey left from and returned to. */
  from?: string;
  to?: string;
};
/** The base journeys start from; never a visit, published at city precision. */
export type Home = {
  id: string;
  label: string;
  country: string;
  city: string;
  coordinates: [number, number];
  since?: string;
  until?: string;
};
export const places = placesData as Place[];
export const homes = homeData as Home[];
export const visits = visitsData as PublicVisit[];
export const trips = tripsData as Trip[];
export const visitsByPlace = new Map<string, PublicVisit[]>();
const placeByVisit = new Map<string, Place>();
const placeByKey = new Map(places.map((place) => [placeKey(place), place]));
for (const visit of visits) {
  if (!visit.visitCount) continue;
  const place = placeByKey.get(placeKey(visit));
  if (place) {
    let group = visitsByPlace.get(place.id);
    if (!group) {
      group = [];
      visitsByPlace.set(place.id, group);
    }
    group.push(visit);
    placeByVisit.set(visit.id, place);
  }
}
// The archive holds z7–14 only in padded windows around places. An empty tile
// (or a 404, which MapLibre treats the same) renders as a blank hole; an errored
// tile makes MapLibre draw the nearest ancestor it has, at worst the global z6.
const protocol = new Protocol({ errorOnMissingTile: true });
maplibregl.addProtocol("pmtiles", protocol.tile);
/** The expected error for a tile outside the archive's detail windows. */
export const isMissingTile = (error: Error) =>
  error.message === "Tile not found.";
const ease = (t: number) => t * t * (3 - 2 * t);
export type Atlas = {
  map: LibreMap;
  firstIdleMs: number;
  /** The basemap archive URL and whether it is served from this origin. */
  archive: { url: string; bundled: boolean };
  select: (id: string) => void;
  deselect: () => void;
  focusTrip: (id: string) => void;
  /** Temporarily light a journey (directory hover); null restores the focus beneath. */
  preview: (id: string | null) => void;
  play: () => void;
  stop: () => void;
  reset: () => void;
  zoomBy: (delta: number) => void;
  setTheme: (theme: Theme) => void;
  filter: (through: string | null, mode: TimeMode) => void;
  destroy: () => void;
};
declare global {
  interface Window {
    __atlas?: Atlas;
  }
}
export async function createMap(
  container: HTMLElement,
  onSelect: (id: string | null) => void,
  onView: (message: string, zoom: number, visibleIds: string[]) => void,
  onFilter: (through: string | null, mode: TimeMode) => void,
  onTour: (playing: boolean) => void,
  signal: AbortSignal,
): Promise<Atlas> {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const deterministic =
    new URLSearchParams(location.search).get("deterministic") === "1";
  const base = new URL(import.meta.env.BASE_URL, location.href);
  const response = await fetch(styleUrl, { signal });
  if (!response.ok)
    throw new Error(`Style ${styleUrl}: HTTP ${response.status}`);
  const style = (await response.json()) as StyleSpecification;
  const remote = import.meta.env.VITE_BASEMAP !== "bundled";
  const archive =
    remote && import.meta.env.VITE_BASEMAP_URL
      ? import.meta.env.VITE_BASEMAP_URL
      : new URL("tiles/basemap.pmtiles", base).href;
  for (const source of Object.values(style.sources))
    if (source.type === "vector") source.url = "pmtiles://" + archive;
  style.glyphs = new URL("glyphs/{fontstack}/{range}.pbf", base).href
    .replaceAll("%7B", "{")
    .replaceAll("%7D", "}");
  style.sprite = new URL("sprites/dark", base).href;
  if (media.matches || deterministic)
    style.transition = { duration: 0, delay: 0 };
  // The first frame already wears the theme the page booted with.
  const initialTheme = currentTheme();
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
    canvasContextAttributes: { antialias: true },
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
  let selected: string | null = null;
  let filterState: { through: string | null; mode: TimeMode } = {
    through: null,
    mode: "cumulative",
  };
  // The URL mirrors what the viewer can see: a place, a moved camera, a filter.
  const currentRoute = () => {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const atHome =
      Math.abs(zoom - home.zoom) < 0.01 &&
      Math.abs(center.lat - home.center[1]) < 0.01 &&
      Math.abs(center.lng - home.center[0]) < 0.01;
    return {
      ...(selected ? { place: selected } : {}),
      ...(!selected && stopped && !atHome
        ? { view: { zoom, lat: center.lat, lng: center.lng } }
        : {}),
      ...(filterState.through ? { through: filterState.through } : {}),
      ...(filterState.mode === "only" ? { mode: filterState.mode } : {}),
    };
  };
  const writeUrl = (method: "push" | "replace" = "replace") => {
    const hash = formatHash(currentRoute());
    if (hash === location.hash) return;
    const url = location.pathname + location.search + hash;
    if (method === "push") history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  };
  // Legacy links carried a 64-character digest; the current ID is its prefix.
  const resolvePlace = (id: string): Place | undefined =>
    placeByVisit.get(id) ??
    visits
      .filter((visit) => id.startsWith(visit.id) && placeByVisit.has(visit.id))
      .map((visit) => placeByVisit.get(visit.id)!)[0];
  let animation = 0;
  let touring = false;
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
  // Journeys stay off the map until one is in focus: a selected stop, a
  // journey chosen in the directory, or a hovered directory entry. The focused
  // group's arcs and numbered stars reveal in travel order; other pins recede.
  const routeData = (style.sources.routes as GeoJSONSourceSpecification)
    .data as FeatureCollection;
  const stopData = (style.sources.stops as GeoJSONSourceSpecification)
    .data as FeatureCollection;
  const segmentsByGroup = new Map<string, string[]>();
  for (const feature of [...routeData.features].sort(
    (a, b) => Number(a.properties?.order) - Number(b.properties?.order),
  )) {
    const group = String(feature.properties?.group);
    segmentsByGroup.set(group, [...(segmentsByGroup.get(group) ?? []), String(feature.id)]);
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
  const groupForPlace = (id: string): string | null =>
    trips.find((trip) => trip.stops.includes(id))?.id ??
    (segmentsByGroup.has(`place:${id}`) ? `place:${id}` : null);
  const membersOf = (group: string): string[] =>
    group.startsWith("place:")
      ? [group.slice("place:".length)]
      : (trips.find((trip) => trip.id === group)?.stops ?? []);
  let baseFocus: string | null = null;
  let shownFocus: string | null = null;
  let currentStop: string | null = null;
  let revealFrame = 0;
  const revealDuration = 420;
  const revealEntries = (group: string) => {
    const segments = segmentsByGroup.get(group) ?? [];
    const leadIn = trips.find((trip) => trip.id === group)?.from ? 1 : 0;
    const stagger = Math.min(220, 1500 / Math.max(1, segments.length));
    return [
      ...segments.map((id, index) => ({ source: "routes", id, at: index * stagger })),
      // A star lights as the arc arriving at it finishes drawing.
      ...(stopsByGroup.get(group) ?? []).map((stop) => {
        const arriving = stop.first - 2 + leadIn;
        return {
          source: "stops",
          id: stop.id,
          at: arriving < 0 ? 0 : arriving * stagger + revealDuration * 0.5,
        };
      }),
    ];
  };
  const markCurrent = (place: string | null) => {
    if (currentStop)
      map.setFeatureState({ source: "stops", id: currentStop }, { current: false });
    currentStop = place && shownFocus ? `${shownFocus}#${place}` : null;
    if (currentStop)
      map.setFeatureState({ source: "stops", id: currentStop }, { current: true });
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
    for (const layer of ["journey-stops", "journey-stop-numbers", "journey-stop-labels"])
      map.setFilter(layer, match);
    const members = new Set(group ? membersOf(group) : []);
    for (const candidate of places)
      map.setFeatureState(
        { source: "pins", id: candidate.id },
        { dim: group && !members.has(candidate.id) ? 1 : 0 },
      );
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
  const focus = (group: string | null, place: string | null = null) => {
    baseFocus = group;
    showFocus(group, place);
  };
  const atlas: Atlas = {
    map,
    firstIdleMs: 0,
    archive: { url: archive, bundled: new URL(archive).origin === location.origin },
    play() {
      if (touring || !places.length) return;
      const stops = selectTourStops(places, places[0]);
      const { width, height } = canvas.getBoundingClientRect();
      const tour = createGlobeTour(stops, { width, height });
      finishIgnition();
      atlas.deselect();
      for (const id of Object.keys(fineSources)) loadFine(id);
      touring = true;
      stopped = true;
      onTour(true);
      const apply = (camera: { center: [number, number]; zoom: number }) =>
        map.jumpTo({ center: camera.center, zoom: camera.zoom, bearing: 0, pitch: 0 });
      if (media.matches) {
        // Reduced motion: hold each shot instead of flying between them.
        let index = 0;
        const next = () => {
          if (!touring) return;
          if (index >= tour.keyframes.length) {
            atlas.stop();
            return;
          }
          apply(tour.keyframes[index].camera);
          index += 1;
          tourTimer = window.setTimeout(next, 1500);
        };
        next();
        return;
      }
      const start = performance.now();
      const frame = (now: number) => {
        if (!touring) return;
        // A frame timestamp can precede the performance.now() taken at start.
        const index = Math.max(0, Math.min(719, Math.floor(((now - start) / 1000) * 30)));
        apply(cameraAtFrame(index, tour));
        if (index >= 719) {
          atlas.stop();
          return;
        }
        tourFrame = requestAnimationFrame(frame);
      };
      tourFrame = requestAnimationFrame(frame);
    },
    stop() {
      if (!touring) return;
      touring = false;
      cancelAnimationFrame(tourFrame);
      clearTimeout(tourTimer);
      onTour(false);
      reportView();
      writeUrl();
    },
    select(id) {
      atlas.stop();
      const home = homes.find((candidate) => candidate.id === id);
      const place = home ? undefined : resolvePlace(id);
      const target = home ?? place;
      if (!target) return;
      selected = target.id;
      focus(place ? groupForPlace(place.id) : null, place?.id ?? null);
      onSelect(target.id);
      writeUrl("push");
      const [x, y] = target.coordinates;
      fly(
        [
          [x - 0.035, y - 0.022],
          [x + 0.035, y + 0.022],
        ],
        11,
      );
    },
    focusTrip(id) {
      const trip = trips.find((candidate) => candidate.id === id);
      if (!trip) return;
      // The frame includes home, so the whole round trip is in view.
      const points = [
        ...trip.stops.map((stop) => places.find((place) => place.id === stop)?.coordinates),
        ...[trip.from, trip.to].map(
          (home) => homes.find((candidate) => candidate.id === home)?.coordinates,
        ),
      ].filter((point): point is [number, number] => Boolean(point));
      if (!points.length) return;
      atlas.deselect();
      focus(trip.id);
      fly(
        [
          [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
          [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
        ],
        6,
        // Clear of the timeline, so a journey's home is never framed beneath it.
        40,
      );
    },
    preview(id) {
      showFocus(id ?? baseFocus);
    },
    deselect() {
      focus(null);
      if (!selected) return;
      selected = null;
      onSelect(null);
      writeUrl();
    },
    zoomBy(delta) {
      finishIgnition();
      stopped = true;
      map.easeTo({
        zoom: map.getZoom() + delta,
        duration: media.matches ? 0 : 320,
        easing: ease,
      });
    },
    reset() {
      atlas.stop();
      finishIgnition();
      focus(null);
      selected = null;
      onSelect(null);
      stopped = false;
      writeUrl();
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
    },
    filter(through, mode) {
      filterState = { through, mode };
      if (!map.getSource("pins")) {
        map.once("style.load", () => atlas.filter(through, mode));
        return;
      }
      writeUrl();
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
    },
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      sky.setTheme(next);
      if (styled) map.setGlobalStateProperty("theme", next);
    },
    destroy() {
      sky.destroy();
      touring = false;
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(tourFrame);
      clearTimeout(tourTimer);
      cancelAnimationFrame(animation);
      cancelAnimationFrame(filtering);
      media.removeEventListener("change", motionChanged);
      window.removeEventListener("hashchange", route);
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
  function route() {
    const parsed = parseHash(location.hash);
    const through = parsed.through ?? null;
    const mode: TimeMode = parsed.mode ?? "cumulative";
    if (through !== filterState.through || mode !== filterState.mode) {
      onFilter(through, mode);
      atlas.filter(through, mode);
    }
    if (parsed.place) {
      const target =
        homes.find((home) => home.id === parsed.place) ?? resolvePlace(parsed.place);
      if (!target) {
        selected = null;
        focus(null);
        onSelect(null);
        return;
      }
      // A legacy or alias link becomes its canonical form in place, never a second entry.
      selected = target.id;
      writeUrl();
      atlas.select(target.id);
    } else if (parsed.view) {
      selected = null;
      focus(null);
      onSelect(null);
      finishIgnition();
      stopped = true;
      map.jumpTo({
        center: [parsed.view.lng, parsed.view.lat],
        zoom: parsed.view.zoom,
        bearing: 0,
        pitch: 0,
      });
    } else {
      selected = null;
      focus(null);
      onSelect(null);
    }
  }
  media.addEventListener("change", motionChanged);
  window.addEventListener("hashchange", route);
  map.once("idle", () => {
    atlas.firstIdleMs = performance.now();
  });
  map.on("style.load", () => {
    if (!media.matches && !deterministic && !location.hash && !stopped) {
      igniting = true;
      for (const f of countries.features) {
        states.set("countries" + f.id, 0);
        map.setFeatureState({ source: "countries", id: f.id! }, { visibility: 0 });
      }
    }
  });
  map.on("load", () => {
    route();
    reportView();
    // Deterministic captures compare fine geometry regardless of camera history.
    if (deterministic) for (const id of Object.keys(fineSources)) loadFine(id);
    refineForZoom();
    if (!media.matches && !deterministic && !location.hash && !stopped) {
      const ordered = [...countries.features].sort((a, b) => {
        const first = (id: unknown) =>
          visits
            .filter((v) => v.country === id)
            .map((v) => v.date ?? v.dateRange?.[0] ?? "9999")
            .sort()[0] ?? "9999";
        return first(a.id).localeCompare(first(b.id));
      });
      const start = performance.now();
      const ignite = (now: number) => {
        let done = true;
        ordered.forEach((f, i) => {
          const visibility = Math.min(
            1,
            Math.max(0, (now - start - i * 260) / 700),
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
      atlas.stop();
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
    // Only a camera the viewer moved becomes part of the link; ignition and
    // programmatic resets never write a view.
    if (stopped && !selected) writeUrl();
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
  // not light while the viewer is still choosing a country.
  for (const source of ["countries", "regions", "pins"] as const) {
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
  // Home answers at any zoom where its ring is drawn, ahead of the band's target.
  const homeAt = (point: maplibregl.Point) => {
    if (map.getZoom() < 3) return undefined;
    return map
      .queryRenderedFeatures(
        [
          [point.x - 6, point.y - 6],
          [point.x + 6, point.y + 6],
        ],
        { layers: ["home-ring"] },
      )
      .find((feature) => (states.get("home" + String(feature.id)) ?? 1) > 0.5);
  };
  map.on("mousemove", (event) => {
    if (homeAt(event.point)) canvas.style.cursor = "pointer";
    else if (!hovered) canvas.style.cursor = "";
  });
  map.on("click", (event) => {
    const home = homeAt(event.point);
    if (home) {
      atlas.select(String(home.id));
      return;
    }
    const layer = activeLayer(map.getZoom());
    const feature = map.queryRenderedFeatures(event.point, {
      layers: [layer],
    })[0];
    if (feature) {
      if (layer === "pins") atlas.select(String(feature.id));
      else {
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
      }
    } else {
      focus(null);
      if (selected) {
        selected = null;
        onSelect(null);
        writeUrl();
      }
    }
  });
  window.__atlas = atlas;
  return atlas;
}
