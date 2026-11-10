import type { TimeMode } from "../map/time";
/**
 * The linkable part of the atlas state as a hash route:
 * #/place/<id>, #/journey/<id> or #/view/<zoom>/<lat>/<lng>, each with
 * ?through=YYYY-MM-DD&mode=only&panel=places|numbers.
 */
export type Route = {
  place?: string;
  journey?: string;
  view?: { zoom: number; lat: number; lng: number };
  through?: string;
  mode?: TimeMode;
  panel?: RoutePanel;
};
export type RoutePanel = "places" | "numbers";
export const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const decode = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text);
  } catch {
    // A malformed escape is simply not an ID.
    return undefined;
  }
};
export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, query = ""] = raw.split("?", 2);
  const route: Route = {};
  const place = path.match(/^\/place\/(.+)$/);
  const journey = path.match(/^\/journey\/(.+)$/);
  const view = path.match(/^\/view\/(-?[\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)$/);
  if (place) {
    const id = decode(place[1]);
    if (id) route.place = id;
  } else if (journey) {
    const id = decode(journey[1]);
    if (id) route.journey = id;
  } else if (view) {
    const [zoom, lat, lng] = view.slice(1).map(Number);
    if (
      Number.isFinite(zoom) && Number.isFinite(lat) && Number.isFinite(lng) &&
      zoom >= 0 && zoom <= 24 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    )
      route.view = { zoom, lat, lng };
  }
  const params = new URLSearchParams(query);
  const through = params.get("through");
  if (through && isoDate.test(through)) route.through = through;
  if (params.get("mode") === "only") route.mode = "only";
  const panel = params.get("panel");
  if (panel === "places" || panel === "numbers") route.panel = panel;
  return route;
}
// toFixed keeps a sign on values that round to zero; the parsed number would not.
const fixed = (value: number, digits: number) => {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? text.replace(/^-/, "") : text;
};
export function formatHash(route: Route): string {
  let path = "";
  if (route.place) path = `/place/${encodeURIComponent(route.place)}`;
  else if (route.journey) path = `/journey/${encodeURIComponent(route.journey)}`;
  else if (route.view)
    path = `/view/${fixed(route.view.zoom, 2)}/${fixed(route.view.lat, 4)}/${fixed(route.view.lng, 4)}`;
  const params = new URLSearchParams();
  if (route.through) params.set("through", route.through);
  if (route.mode === "only") params.set("mode", "only");
  if (route.panel) params.set("panel", route.panel);
  const query = params.toString();
  if (!path && !query) return "";
  return `#${path}${query ? `?${query}` : ""}`;
}
