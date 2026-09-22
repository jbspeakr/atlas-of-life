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
import placesData from "../generated/places.json";
import visitsData from "../generated/visits.json";
import { placeKey } from "./place-key";
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
export const places = placesData as Place[];
export const visits = visitsData as PublicVisit[];
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
  reset: () => void;
  filter: (year: number) => void;
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
  const map = new maplibregl.Map({
    container,
    style,
    center: [10, 35],
    zoom: innerWidth < 700 ? 0.65 : 1.8,
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
  let animation = 0;
  let igniting = false;
  let stopped = false;
  let filtering = 0;
  const countrySource = style.sources.countries as GeoJSONSourceSpecification;
  const regionSource = style.sources.regions as GeoJSONSourceSpecification;
  const countries = countrySource.data as FeatureCollection;
  const regions = regionSource.data as FeatureCollection;
  const states = new Map<string, number>();
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
      const place = placeByVisit.get(id);
      if (!place) return;
      selected = place.id;
      onSelect(place.id);
      if (location.hash !== "#/place/" + place.id)
        history.pushState(null, "", "#/place/" + place.id);
      const [x, y] = place.coordinates;
      fly(
        [
          [x - 0.035, y - 0.022],
          [x + 0.035, y + 0.022],
        ],
        11,
      );
    },
    reset() {
      finishIgnition();
      selected = null;
      onSelect(null);
      history.replaceState(null, "", location.pathname + location.search);
      stopped = true;
      map.flyTo({
        center: [10, 35],
        zoom: innerWidth < 700 ? 0.65 : 1.8,
        bearing: 0,
        pitch: 0,
        speed: 0.72,
        curve: 1.5,
        easing: ease,
        animate: !media.matches,
      });
    },
    filter(year) {
      if (!map.getSource("pins")) {
        map.once("style.load", () => atlas.filter(year));
        return;
      }
      stopped = true;
      igniting = false;
      cancelAnimationFrame(filtering);
      cancelAnimationFrame(animation);
      const start = performance.now();
      const values = features.map((f) => {
        const key = f.source + f.id;
        const target = Math.max(
          0,
          ...f.visits.map((v) => {
            const date = v.date ?? v.dateRange?.[0];
            if (!date) return 1;
            const first = Number(date.slice(0, 4));
            return Math.min(1, Math.max(0, (year - first + 0.5) * 2));
          }),
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
    const match = location.hash.match(/^#\/place\/(.+)$/);
    if (match) {
      try {
        const place = placeByVisit.get(decodeURIComponent(match[1]));
        if (!place) {
          selected = null;
          onSelect(null);
          return;
        }
        history.replaceState(null, "", "#/place/" + place.id);
        atlas.select(place.id);
      } catch {
        onSelect(null);
      }
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
  map.on("resize", reportView);
  let hovered: string | number | undefined;
  map.on("mousemove", "pins", (event) => {
    const id = event.features?.[0]?.id;
    if (hovered !== undefined && hovered !== id)
      map.setFeatureState({ source: "pins", id: hovered }, { hover: false });
    if (id !== undefined)
      map.setFeatureState({ source: "pins", id }, { hover: true });
    hovered = id;
    canvas.style.cursor = "pointer";
  });
  map.on("mouseleave", "pins", () => {
    if (hovered !== undefined)
      map.setFeatureState({ source: "pins", id: hovered }, { hover: false });
    hovered = undefined;
    canvas.style.cursor = "";
  });
  map.on("click", (event) => {
    const z = map.getZoom();
    const layer = z >= 6.5 ? "pins" : z >= 3.5 ? "regions" : "countries";
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
      history.replaceState(null, "", location.pathname + location.search);
    }
  });
  window.__atlas = atlas;
  return atlas;
}
