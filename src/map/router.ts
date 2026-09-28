import type { TimeMode } from "./time";
/** Hash routes: #/place/<id>, #/view/<zoom>/<lat>/<lng>, each with ?through=YYYY-MM-DD&mode=only. */
export type Route = {
  place?: string;
  view?: { zoom: number; lat: number; lng: number };
  through?: string;
  mode?: TimeMode;
};
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, query = ""] = raw.split("?", 2);
  const route: Route = {};
  const place = path.match(/^\/place\/(.+)$/);
  const view = path.match(/^\/view\/(-?[\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)$/);
  if (place) {
    try {
      route.place = decodeURIComponent(place[1]);
    } catch {
      /* A malformed escape is simply not a place. */
    }
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
  else if (route.view)
    path = `/view/${fixed(route.view.zoom, 2)}/${fixed(route.view.lat, 4)}/${fixed(route.view.lng, 4)}`;
  const params = new URLSearchParams();
  if (route.through) params.set("through", route.through);
  if (route.mode === "only") params.set("mode", "only");
  const query = params.toString();
  if (!path && !query) return "";
  return `#${path}${query ? `?${query}` : ""}`;
}
