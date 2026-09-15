import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { DARK, layers } from "@protomaps/basemaps";
import type { Flavor } from "@protomaps/basemaps";
import type { FeatureCollection } from "geojson";
import type {
  StyleSpecification,
  LayerSpecification,
  ExpressionSpecification,
} from "maplibre-gl";
import { bands, withVisibility } from "../src/map/expressions.ts";
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
const quietColors = Object.fromEntries(
  Object.entries(DARK)
    .filter(([, value]) => typeof value === "string" && value.startsWith("#"))
    .map(([key]) => [key, key.includes("casing") ? "#121c27" : "#243240"]),
);
const flavor: Flavor = {
  ...DARK,
  ...quietColors,
  background: "#080f18",
  earth: "#121c27",
  water: "#080f18",
  boundaries: "#2b3947",
  buildings: "#1b2733",
  park_a: "#15212b",
  park_b: "#15212b",
  wood_a: "#15212b",
  wood_b: "#15212b",
  country_label: "#a7b2bf",
  city_label: "#a7b2bf",
  state_label: "#a7b2bf",
};
// Cartography carries the quiet context; only authored place names receive labels.
const baseLayers = layers("basemap", flavor).filter(
  (layer) => !layer.id.includes("landcover"),
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
}[];
const visible: ExpressionSpecification = [
  "coalesce",
  ["feature-state", "visibility"],
  1,
];
const pinOpacity = withVisibility(bands.pin);
const style: StyleSpecification = {
  version: 8,
  name: "Atlas — lamplight",
  projection: { type: "globe" },
  glyphs: "./glyphs/{fontstack}/{range}.pbf",
  transition: { duration: 300, delay: 0 },
  sources: {
    basemap: { type: "vector", url: "pmtiles://./tiles/basemap.pmtiles" },
    countries: {
      type: "geojson",
      promoteId: "country",
      data: geo("countries"),
    },
    "countries-fine": {
      type: "geojson",
      promoteId: "country",
      data: geo("countries-fine"),
    },
    regions: {
      type: "geojson",
      promoteId: "region",
      data: geo("regions-fine"),
    },
    pins: {
      type: "geojson",
      promoteId: "id",
      data: {
        type: "FeatureCollection",
        features: places.map((p) => ({
          type: "Feature",
          id: p.id,
          properties: p,
          geometry: { type: "Point", coordinates: p.coordinates },
        })),
      },
    },
  },
  layers: [
    ...baseLayers,
    {
      id: "country-glow",
      type: "line",
      source: "countries",
      paint: {
        "line-color": "#efc784",
        "line-width": 6,
        "line-blur": 5,
        "line-opacity": withVisibility(bands.country),
      },
    },
    {
      id: "countries",
      type: "fill",
      source: "countries",
      paint: {
        "fill-color": "#efc784",
        "fill-opacity": withVisibility(bands.country, 0.4),
      },
    },
    {
      id: "country-outline",
      type: "line",
      source: "countries-fine",
      paint: {
        "line-color": "#efc784",
        "line-width": 0.65,
        "line-opacity": withVisibility(bands.country),
      },
    },
    {
      id: "regions",
      type: "fill",
      source: "regions",
      paint: {
        "fill-color": "#efc784",
        "fill-opacity": withVisibility(bands.region, 0.4),
      },
    },
    {
      id: "region-outline",
      type: "line",
      source: "regions",
      paint: {
        "line-color": "#efc784",
        "line-width": 0.8,
        "line-opacity": withVisibility(bands.region),
      },
    },
    {
      id: "pin-halos",
      type: "circle",
      source: "pins",
      paint: {
        "circle-color": "#efc784",
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
            ["case", ["boolean", ["feature-state", "hover"], false], 0.8, 0.25],
          ],
          16,
          [
            "*",
            visible,
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
        "circle-color": "#efc784",
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
          "interpolate",
          ["linear"],
          ["get", "visitCount"],
          1,
          1,
          4,
          2,
        ],
        "circle-stroke-color": "#f1eee7",
        "circle-stroke-opacity": pinOpacity,
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
        "text-color": "#f1eee7",
        "text-halo-color": "#080f18",
        "text-halo-width": 2,
        "text-opacity": pinOpacity,
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
  paint: { "fill-color": "#121c27" },
});
const labels = Object.fromEntries(
  geo("regions").features.map((feature) => [
    String(feature.id),
    String(feature.properties?.label),
  ]),
);
writeFileSync("src/generated/region-labels.json", JSON.stringify(labels));
const ranges = new Set(
  places.flatMap((place) =>
    [...place.label].map(
      (character) => Math.floor(character.codePointAt(0)! / 256) * 256,
    ),
  ),
);
for (const start of ranges) {
  const range = `${start}-${start + 255}.pbf`;
  const directory = "public/glyphs/Noto Sans Regular";
  const filename = `${directory}/${range}`;
  if (existsSync(filename)) continue;
  if (process.env.ATLAS_FIXTURE === "1")
    throw new Error(
      `Missing committed fixture glyph ${filename}; verification forbids network`,
    );
  const url = `https://raw.githubusercontent.com/protomaps/basemaps-assets/${mapAssets.commit}/fonts/Noto%20Sans%20Regular/${range}`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Glyph download ${url}: HTTP ${response.status}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
}
writeFileSync("src/generated/style.json", JSON.stringify(style));
console.log(
  `Style: ${style.layers.length} layers, globe projection, all semantic layers continuously present.`,
);
