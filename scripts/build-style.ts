import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { DARK, layers } from "@protomaps/basemaps";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { Flavor } from "@protomaps/basemaps";
import type { FeatureCollection } from "geojson";
import type {
  StyleSpecification,
  LayerSpecification,
  ExpressionSpecification,
} from "maplibre-gl";
import {
  apart,
  bands,
  revealed,
  scaleBand,
  undimmed,
  withVisibility,
} from "../src/map/expressions.ts";
import { mergeThemes } from "./themes.ts";
import mapAssets from "../data/map-assets.json";
if (
  !existsSync("public/tiles/basemap.pmtiles") &&
  process.env.VITE_BASEMAP !== "remote"
) {
  mkdirSync("public/tiles", { recursive: true });
  copyFileSync(
    "verification/fixtures/basemap.pmtiles",
    "public/tiles/basemap.pmtiles",
  );
  console.log(
    "Installed the committed preview tile fixture. Use basemap:build for complete global z0–6 coverage.",
  );
}
// Two palettes share one style. Every colour that differs is a `global-state`
// switch, so changing theme repaints in place and keeps feature-state intact.
const palettes = {
  dark: {
    ocean: "#080f18",
    land: "#121c27",
    line: "#2b3947",
    quiet: "#243240",
    building: "#1b2733",
    green: "#15212b",
    accent: "#efc784",
    fill: "#efc784",
    outline: "#bcaa88",
    ink: "#f1eee7",
    muted: "#a7b2bf",
    halo: "#080f18",
    onAccent: "#080f18",
  },
  light: {
    ocean: "#d3dce4",
    land: "#f7f5f0",
    line: "#bcc3ca",
    quiet: "#e4e2dc",
    building: "#eae7e0",
    green: "#eeeee6",
    accent: "#c98a22",
    fill: "#c27a14",
    outline: "#b0874a",
    ink: "#1e2731",
    muted: "#56626e",
    halo: "#f7f5f0",
    onAccent: "#1e2731",
  },
};
type Palette = (typeof palettes)["dark"];
const theme: ExpressionSpecification = [
  "==",
  ["to-string", ["global-state", "theme"]],
  "light",
];
const color = (role: keyof Palette): string | ExpressionSpecification =>
  palettes.dark[role] === palettes.light[role]
    ? palettes.dark[role]
    : ["case", theme, palettes.light[role], palettes.dark[role]];
const flavorOf = (palette: Palette): Flavor => ({
  ...DARK,
  ...Object.fromEntries(
    Object.entries(DARK)
      .filter(([, value]) => typeof value === "string" && value.startsWith("#"))
      .map(([key]) => [key, key.includes("casing") ? palette.land : palette.quiet]),
  ),
  background: palette.ocean,
  earth: palette.land,
  water: palette.ocean,
  boundaries: palette.line,
  buildings: palette.building,
  park_a: palette.green,
  park_b: palette.green,
  wood_a: palette.green,
  wood_b: palette.green,
  country_label: palette.muted,
  city_label: palette.muted,
  state_label: palette.muted,
});
// Cartography carries the quiet context; only authored place names receive labels.
const baseLayers = (palette: Palette) =>
  layers("basemap", flavorOf(palette)).filter(
    (layer) => !layer.id.includes("landcover"),
  ) as LayerSpecification[];
const themedBaseLayers = mergeThemes(
  baseLayers(palettes.dark),
  baseLayers(palettes.light),
  theme,
) as LayerSpecification[];
const geo = (name: string) =>
  JSON.parse(
    readFileSync(`src/generated/${name}.geojson`, "utf8"),
  ) as FeatureCollection;
const places = JSON.parse(
  readFileSync("src/generated/places.json", "utf8"),
) as {
  id: string;
  label: string;
  coordinates: [number, number];
  visitCount: number;
  dayTrips?: number;
  via?: number;
}[];
const anchors = JSON.parse(
  readFileSync("src/generated/anchors.json", "utf8"),
) as FeatureCollection;
const anchorLabels = anchors.features.map((feature) =>
  String(feature.properties?.label),
);
const routes = JSON.parse(
  readFileSync("src/generated/routes.json", "utf8"),
) as FeatureCollection;
const trips = JSON.parse(readFileSync("src/generated/trips.json", "utf8")) as {
  id: string;
  stops: string[];
}[];
const homes = JSON.parse(readFileSync("src/generated/home.json", "utf8")) as {
  id: string;
  label: string;
  coordinates: [number, number];
}[];
// One numbered star per journey stop; a place revisited later in the same
// journey carries both numbers rather than stacking two badges.
const placeById = new Map(places.map((place) => [place.id, place]));
const stops: FeatureCollection = {
  type: "FeatureCollection",
  features: trips.flatMap((trip) => {
    const numbers = new Map<string, number[]>();
    trip.stops.forEach((stop, index) =>
      numbers.set(stop, [...(numbers.get(stop) ?? []), index + 1]),
    );
    return [...numbers].map(([stop, order]) => {
      const place = placeById.get(stop)!;
      const id = `${trip.id}#${stop}`;
      return {
        type: "Feature" as const,
        id,
        properties: { id, group: trip.id, place: stop, n: order.join("·"), label: place.label },
        geometry: { type: "Point" as const, coordinates: place.coordinates },
      };
    });
  }),
};
// One satellite per day trip's place within its base's group, from the lenses
// the geo build drew; it carries the distance that decides when it may show.
const satellites: FeatureCollection = {
  type: "FeatureCollection",
  features: routes.features.flatMap((feature) => {
    const { group, kind, place, from, km, order } = feature.properties as {
      group: string;
      kind: string;
      place?: string;
      from?: string;
      km?: number;
      order: number;
    };
    if (kind !== "excursion" || !place || !from) return [];
    const id = `${group}#${place}`;
    if (routes.features.some((other) => {
      const p = other.properties as { group: string; kind: string; place?: string; order: number };
      return p.kind === "excursion" && p.group === group && p.place === place && p.order < order;
    }))
      return [];
    const target = placeById.get(place)!;
    return [
      {
        type: "Feature" as const,
        id,
        properties: { id, group, place, from, km, label: target.label },
        geometry: { type: "Point" as const, coordinates: target.coordinates },
      },
    ];
  }),
};
// One mark per place passed on the way within its group, from the arcs the geo
// build drew through it; it carries the distance that decides when it may show.
const waypoints: FeatureCollection = {
  type: "FeatureCollection",
  features: routes.features.flatMap((feature) => {
    const { group, kind, place, km, order } = feature.properties as {
      group: string;
      kind: string;
      place?: string;
      km?: number;
      order: number;
    };
    if (kind === "excursion" || !place) return [];
    const id = `${group}#${place}`;
    if (routes.features.some((other) => {
      const p = other.properties as { group: string; kind: string; place?: string; order: number };
      return p.kind !== "excursion" && p.group === group && p.place === place && p.order < order;
    }))
      return [];
    const target = placeById.get(place)!;
    return [
      {
        type: "Feature" as const,
        id,
        properties: { id, group, place, km, label: target.label },
        geometry: { type: "Point" as const, coordinates: target.coordinates },
      },
    ];
  }),
};
const nothing: ExpressionSpecification = ["==", ["get", "group"], ""];
// A place only ever seen on day trips or passed on the way is a hollow
// lamplight ring: visited, never slept in.
const hollow: ExpressionSpecification = [
  ">=",
  ["+", ["coalesce", ["get", "dayTrips"], 0], ["coalesce", ["get", "via"], 0]],
  ["coalesce", ["get", "visitCount"], 1],
];
const visible: ExpressionSpecification = [
  "coalesce",
  ["feature-state", "visibility"],
  1,
];
const pinOpacity = scaleBand(withVisibility(bands.pin), undimmed);
const hoverWidth = (rest: number, hover: number): ExpressionSpecification => [
  "case",
  ["boolean", ["feature-state", "hover"], false],
  hover,
  rest,
];
const style: StyleSpecification = {
  version: 8,
  name: "Atlas — lamplight",
  state: { theme: { default: "dark" } },
  projection: { type: "globe" },
  glyphs: "./glyphs/{fontstack}/{range}.pbf",
  sprite: "./sprites/dark",
  transition: { duration: 300, delay: 0 },
  sources: {
    basemap: { type: "vector", url: "pmtiles://./tiles/basemap.pmtiles" },
    countries: {
      type: "geojson",
      promoteId: "country",
      data: geo("countries"),
    },
    // Coarse LODs ship inline; the fine LODs are hashed assets the app swaps in
    // once the viewer zooms past the band where their detail becomes visible.
    regions: {
      type: "geojson",
      promoteId: "region",
      data: geo("regions"),
    },
    anchors: {
      type: "geojson",
      promoteId: "id",
      data: anchors,
    },
    // Journey arcs and stars exist in the style but draw only for the focused group.
    routes: {
      type: "geojson",
      promoteId: "id",
      data: routes,
    },
    stops: {
      type: "geojson",
      promoteId: "id",
      data: stops,
    },
    satellites: {
      type: "geojson",
      promoteId: "id",
      data: satellites,
    },
    waypoints: {
      type: "geojson",
      promoteId: "id",
      data: waypoints,
    },
    home: {
      type: "geojson",
      promoteId: "id",
      data: {
        type: "FeatureCollection",
        features: homes.map((home) => ({
          type: "Feature",
          id: home.id,
          properties: { id: home.id, label: home.label },
          geometry: { type: "Point", coordinates: home.coordinates },
        })),
      },
    },
    pins: {
      type: "geojson",
      promoteId: "id",
      data: {
        type: "FeatureCollection",
        // The ring is a home's only mark, so its place draws no pin or pin label.
        features: places
          .filter((p) => !homes.some((home) => home.id === p.id))
          .map((p) => ({
            type: "Feature",
            id: p.id,
            properties: p,
            geometry: { type: "Point", coordinates: p.coordinates },
          })),
      },
    },
  },
  layers: [
    ...themedBaseLayers,
    {
      id: "countries",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": color("fill"),
        "fill-opacity": scaleBand(withVisibility(bands.country, 0.24), undimmed),
        "fill-antialias": false,
      },
    },
    {
      id: "country-outline",
      type: "line",
      source: "countries",
      paint: {
        "line-color": color("outline"),
        "line-width": hoverWidth(0.8, 1.6),
        "line-opacity": scaleBand(withVisibility(bands.country, 0.7), undimmed),
      },
    },
    {
      id: "regions",
      type: "fill",
      source: "regions",
      paint: {
        "fill-color": color("fill"),
        "fill-opacity": scaleBand(withVisibility(bands.region, 0.4), undimmed),
      },
    },
    {
      id: "region-outline",
      type: "line",
      source: "regions",
      paint: {
        "line-color": color("accent"),
        "line-width": hoverWidth(0.8, 1.6),
        "line-opacity": scaleBand(withVisibility(bands.region), undimmed),
      },
    },
    {
      id: "journey-legs",
      type: "line",
      source: "routes",
      filter: ["all", ["==", ["get", "kind"], "leg"], nothing],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color("accent"),
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.3, 10, 1.8],
        // Round-capped zero-length dashes draw dots: sparser for the way out and home.
        "line-dasharray": [0, 3.2],
        "line-opacity": scaleBand(bands.focus, ["*", 0.5, revealed]),
      },
    },
    {
      id: "journey-hops",
      type: "line",
      source: "routes",
      filter: ["all", ["==", ["get", "kind"], "hop"], nothing],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color("accent"),
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.9, 10, 2.6],
        "line-dasharray": [0, 2.1],
        "line-opacity": scaleBand(bands.focus, ["*", 0.95, revealed]),
      },
    },
    {
      id: "journey-excursions",
      type: "line",
      source: "routes",
      filter: ["all", ["==", ["get", "kind"], "excursion"], nothing],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color("accent"),
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.3, 10, 1.8],
        // A lens of fine dots: out and back the same day, lighter than a hop.
        "line-dasharray": [0, 2.1],
        "line-opacity": apart(bands.focus, ["*", 0.75, revealed]),
      },
    },
    {
      id: "pin-halos",
      type: "circle",
      source: "pins",
      paint: {
        "circle-color": color("accent"),
        "circle-blur": 0.75,
        "circle-radius": [
          "interpolate",
          ["exponential", 1.25],
          ["zoom"],
          0,
          3,
          6,
          7,
          10,
          13,
          16,
          19,
        ],
        "circle-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          0,
          5.75,
          0,
          7.25,
          [
            "*",
            visible,
            undimmed,
            ["case", ["boolean", ["feature-state", "hover"], false], 0.8, 0.25],
          ],
          16,
          [
            "*",
            visible,
            undimmed,
            ["case", ["boolean", ["feature-state", "hover"], false], 0.8, 0.25],
          ],
        ],
      },
    },
    {
      id: "pins",
      type: "circle",
      source: "pins",
      paint: {
        "circle-color": ["case", hollow, color("halo"), color("accent")],
        "circle-radius": [
          "interpolate",
          ["exponential", 1.3],
          ["zoom"],
          0,
          1,
          6,
          2.5,
          10,
          4,
          16,
          6,
        ],
        "circle-opacity": pinOpacity,
        "circle-stroke-width": [
          "case",
          hollow,
          1.5,
          ["interpolate", ["linear"], ["get", "visitCount"], 1, 1, 4, 2],
        ],
        "circle-stroke-color": ["case", hollow, color("accent"), color("ink")],
        "circle-stroke-opacity": pinOpacity,
      },
    },
    // Home: a hollow ring with a point at its centre, parchment rather than
    // lamplight, so it reads as the origin and never as another place visited.
    {
      id: "home-ring",
      type: "circle",
      source: "home",
      paint: {
        "circle-color": color("halo"),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 8, 5.5, 16, 8],
        "circle-opacity": withVisibility(bands.home, 0.55),
        "circle-stroke-width": 1.5,
        "circle-stroke-color": color("ink"),
        "circle-stroke-opacity": withVisibility(bands.home),
      },
    },
    {
      id: "home-core",
      type: "circle",
      source: "home",
      paint: {
        "circle-color": color("ink"),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1, 8, 1.4, 16, 2],
        "circle-opacity": withVisibility(bands.home),
      },
    },
    // Beneath the boundary names so home never displaces the atlas's own labels.
    {
      id: "home-label",
      type: "symbol",
      source: "home",
      layout: {
        "text-field": [
          "format",
          ["get", "label"],
          {},
          "\n",
          {},
          "home",
          { "font-scale": 0.8 },
        ],
        "text-font": ["Noto Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 14, 14],
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": color("muted"),
        "text-halo-color": color("halo"),
        "text-halo-width": 2,
        "text-opacity": withVisibility(bands.homeLabel),
      },
    },
    {
      id: "country-labels",
      type: "symbol",
      source: "anchors",
      filter: ["==", ["get", "kind"], "country"],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 4.5, 13],
        "text-letter-spacing": 0.08,
        "text-transform": "uppercase",
        "text-allow-overlap": false,
        "symbol-sort-key": 0,
      },
      paint: {
        "text-color": color("muted"),
        "text-halo-color": color("halo"),
        "text-halo-width": 1.5,
        "text-opacity": scaleBand(withVisibility(bands.countryLabel), undimmed),
      },
    },
    {
      id: "region-labels",
      type: "symbol",
      source: "anchors",
      filter: ["==", ["get", "kind"], "region"],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 7, 13],
        "text-allow-overlap": false,
        "symbol-sort-key": 1,
      },
      paint: {
        "text-color": color("muted"),
        "text-halo-color": color("halo"),
        "text-halo-width": 1.5,
        "text-opacity": scaleBand(withVisibility(bands.regionLabel), undimmed),
      },
    },
    {
      id: "place-labels",
      type: "symbol",
      source: "pins",
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          11,
          7,
          12,
          14,
          15,
        ],
        "text-anchor": "top",
        "text-offset": [0, 1.1],
        "text-allow-overlap": false,
        "symbol-sort-key": ["-", 0, ["get", "visitCount"]],
      },
      paint: {
        "text-color": color("ink"),
        "text-halo-color": color("halo"),
        "text-halo-width": 2,
        "text-opacity": pinOpacity,
      },
    },
    // Stops on the way: a small filled dot on the route, unnumbered, where the
    // arcs bend through the town; the tick of an ordinary station beside the
    // circles of the stops. Hidden until it stands clear of its nearer neighbour.
    {
      id: "journey-via",
      type: "circle",
      source: "waypoints",
      filter: nothing,
      paint: {
        "circle-color": color("accent"),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2.2, 8, 3, 16, 3.5],
        "circle-opacity": apart(bands.focus, revealed),
        "circle-stroke-color": [
          "case",
          ["boolean", ["feature-state", "current"], false],
          color("ink"),
          color("halo"),
        ],
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "current"], false],
          2,
          1,
        ],
        "circle-stroke-opacity": apart(bands.focus, revealed),
      },
    },
    {
      id: "journey-via-labels",
      type: "symbol",
      source: "waypoints",
      filter: nothing,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-anchor": "left",
        "text-offset": [0.7, 0],
        "text-optional": true,
      },
      paint: {
        "text-color": color("muted"),
        "text-halo-color": color("halo"),
        "text-halo-width": 2,
        "text-opacity": apart(bands.focusLabel, revealed),
      },
    },
    // Day trips: small hollow rings beside their base, unnumbered, that appear
    // once the viewer is close enough for the lens to read; stars draw above them.
    {
      id: "journey-daytrips",
      type: "circle",
      source: "satellites",
      filter: nothing,
      paint: {
        "circle-color": color("halo"),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3.5, 8, 4.5, 16, 5.5],
        "circle-opacity": apart(bands.focus, revealed),
        "circle-stroke-color": [
          "case",
          ["boolean", ["feature-state", "current"], false],
          color("ink"),
          color("accent"),
        ],
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "current"], false],
          2,
          1.5,
        ],
        "circle-stroke-opacity": apart(bands.focus, revealed),
      },
    },
    {
      id: "journey-daytrip-labels",
      type: "symbol",
      source: "satellites",
      filter: nothing,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-anchor": "left",
        "text-offset": [0.8, 0],
        "text-optional": true,
      },
      paint: {
        "text-color": color("muted"),
        "text-halo-color": color("halo"),
        "text-halo-width": 2,
        "text-opacity": apart(bands.focusLabel, revealed),
      },
    },
    {
      id: "journey-stops",
      type: "circle",
      source: "stops",
      filter: nothing,
      paint: {
        "circle-color": color("accent"),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 6, 8, 8, 16, 9],
        "circle-opacity": scaleBand(bands.focus, revealed),
        "circle-stroke-color": [
          "case",
          ["boolean", ["feature-state", "current"], false],
          color("ink"),
          color("halo"),
        ],
        "circle-stroke-width": [
          "case",
          ["boolean", ["feature-state", "current"], false],
          2,
          1,
        ],
        "circle-stroke-opacity": scaleBand(bands.focus, revealed),
      },
    },
    {
      id: "journey-stop-numbers",
      type: "symbol",
      source: "stops",
      filter: nothing,
      layout: {
        "text-field": ["get", "n"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 10,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": color("onAccent"),
        "text-opacity": scaleBand(bands.focus, revealed),
      },
    },
    {
      id: "journey-stop-labels",
      type: "symbol",
      source: "stops",
      filter: nothing,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-anchor": "left",
        "text-offset": [1.1, 0],
        "text-optional": true,
      },
      paint: {
        "text-color": color("ink"),
        "text-halo-color": color("halo"),
        "text-halo-width": 2,
        "text-opacity": scaleBand(bands.focusLabel, revealed),
      },
    },
  ],
};
// A low-zoom earth underlay avoids rectangular voids outside extracted city windows.
// It uses the same archive, not an additional worldwide dataset.
style.sources.overview = {
  type: "vector",
  url: "pmtiles://./tiles/basemap.pmtiles",
  maxzoom: 3,
};
style.layers.splice(1, 0, {
  id: "overview-earth",
  type: "fill",
  source: "overview",
  "source-layer": "earth",
  minzoom: 3,
  paint: { "fill-color": color("land") },
});
const labels = Object.fromEntries(
  anchors.features
    .filter((feature) => feature.properties?.kind === "region")
    .map((feature) => [String(feature.id), String(feature.properties?.label)]),
);
writeFileSync("src/generated/region-labels.json", JSON.stringify(labels));
const rangesOf = (labels: string[]) =>
  labels.flatMap((label) =>
    [...label].map(
      (character) =>
        Math.floor(character.codePointAt(0)! / 256) * 256,
    ),
  );
const ranges = new Set([
  ...rangesOf([...places.map((place) => place.label), ...anchorLabels]).map(
    (start) => ["Noto Sans Regular", start] as const,
  ),
  ...rangesOf([...homes.map((home) => home.label), "home"]).map(
    (start) => ["Noto Sans Italic", start] as const,
  ),
].map((entry) => entry.join("|")));
for (const entry of ranges) {
  const [font, first] = entry.split("|");
  const start = Number(first);
  const range = `${start}-${start + 255}.pbf`;
  const directory = `public/glyphs/${font}`;
  const filename = `${directory}/${range}`;
  if (existsSync(filename)) continue;
  if (process.env.ATLAS_FIXTURE === "1")
    throw new Error(
      `Missing committed fixture glyph ${filename}; verification forbids network`,
    );
  const url = `https://raw.githubusercontent.com/protomaps/basemaps-assets/${mapAssets.commit}/fonts/${encodeURIComponent(font)}/${range}`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Glyph download ${url}: HTTP ${response.status}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
}
// The browser skips style validation for speed, so the build must not.
const invalid = validateStyleMin(style as Parameters<typeof validateStyleMin>[0]);
if (invalid.length)
  throw new Error(
    `Invalid style:\n${invalid.map((error) => error.message).join("\n")}`,
  );
writeFileSync("src/generated/style.json", JSON.stringify(style));
console.log(
  `Style: ${style.layers.length} layers, globe projection, all semantic layers continuously present.`,
);
