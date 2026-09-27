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
import { placeKey } from "./place-key";
import { activeLayer } from "./layers";
import { visibleAt, type TimeMode } from "./time";
import { formatHash, parseHash } from "./router";
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
};
export const places = placesData as Place[];
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
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
const ease = (t: number) => t * t * (3 - 2 * t);
export type Atlas = {
  map: LibreMap;
  firstIdleMs: number;
  select: (id: string) => void;
  deselect: () => void;
  focusTrip: (id: string) => void;
  reset: () => void;
  zoomBy: (delta: number) => void;
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
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
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
    // A journey lights with its first stop and follows the same filter.
    ...trips.map((trip) => ({
      source: "routes",
      id: trip.id,
      visits: trip.stops.flatMap((stop) => visitsByPlace.get(stop) ?? []),
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
  const fly = (bounds: LngLatBoundsLike, maxZoom: number) => {
    finishIgnition();
    stopped = true;
    const camera = map.cameraForBounds(bounds, {
      padding: {
        top: innerWidth > 700 ? 110 : 125,
        bottom: innerWidth > 700 ? 100 : 190,
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
  const atlas: Atlas = {
    map,
    firstIdleMs: 0,
    select(id) {
      const place = resolvePlace(id);
      if (!place) return;
      selected = place.id;
      onSelect(place.id);
      writeUrl("push");
      const [x, y] = place.coordinates;
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
      const points = trip.stops
        .map((stop) => places.find((place) => place.id === stop)?.coordinates)
        .filter((point): point is [number, number] => Boolean(point));
      if (!points.length) return;
      atlas.deselect();
      fly(
        [
          [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
          [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
        ],
        6,
      );
    },
    deselect() {
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
      finishIgnition();
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
    destroy() {
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
      const place = resolvePlace(parsed.place);
      if (!place) {
        selected = null;
        onSelect(null);
        return;
      }
      // A legacy or alias link becomes its canonical form in place, never a second entry.
      selected = place.id;
      writeUrl();
      atlas.select(place.id);
    } else if (parsed.view) {
      selected = null;
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
  map.on("moveend", reportView);
  map.on("moveend", () => {
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
  map.on("click", (event) => {
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
    } else if (selected) {
      selected = null;
      onSelect(null);
      writeUrl();
    }
  });
  window.__atlas = atlas;
  return atlas;
}
