import type { TimeMode } from "../map/time";
import type { Theme } from "../theme";
import { isoDate, type Route } from "./router";
/**
 * The atlas as one value. Every surface reads it, and every change to it is a
 * pure transition from an action, so the map, the React tree and the URL can
 * never disagree about what is selected, lit or open.
 */
export type Subject =
  | { kind: "none" }
  /** A place or a home: a home is also a place under the same ID. */
  | { kind: "place"; id: string }
  | { kind: "journey"; id: string };
/** The camera a link records: the opening view, or one the viewer moved to. */
export type Camera =
  | { kind: "home" }
  | { kind: "moved"; zoom: number; lat: number; lng: number };
export type Timeline = { through: string | null; mode: TimeMode };
export type Panel = "none" | "places" | "numbers";
export type AtlasState = {
  subject: Subject;
  camera: Camera;
  timeline: Timeline;
  panel: Panel;
  touring: boolean;
  /** A journey lit while its directory entry is hovered or focused. */
  preview: string | null;
  theme: Theme;
};
export type Action =
  | { type: "select"; id: string }
  | { type: "deselect" }
  | { type: "focusJourney"; id: string }
  | { type: "preview"; id: string | null }
  | { type: "filter"; through: string | null; mode: TimeMode }
  | { type: "togglePanel"; panel: "places" | "numbers" }
  | { type: "closePanel"; panel: "places" | "numbers" }
  | { type: "playTour" }
  | { type: "stopTour" }
  | { type: "reset" }
  /** The map settled on a camera the viewer moved to. */
  | { type: "moved"; camera: Camera }
  | { type: "escape" }
  /** The viewer picked a theme; it is remembered. */
  | { type: "chooseTheme"; theme: Theme }
  /** The system appearance changed while the viewer had not picked one. */
  | { type: "systemTheme"; theme: Theme }
  /** The URL changed under the page: a link, Back or Forward. */
  | { type: "route"; route: Route };
/** What the transitions need to know about the published atlas. */
export type Catalog = {
  /** The canonical place or home ID for an ID or legacy alias. */
  resolvePlace: (id: string) => string | undefined;
  hasJourney: (id: string) => boolean;
};
export const initialState = (theme: Theme): AtlasState => ({
  subject: { kind: "none" },
  camera: { kind: "home" },
  timeline: { through: null, mode: "cumulative" },
  panel: "none",
  touring: false,
  preview: null,
  theme,
});
/** What Escape closes, innermost first: the tour, the numbers, a place, the directory, a journey. */
export type EscapeTarget = "tour" | "numbers" | "place" | "places" | "journey";
export function escapeTarget(state: AtlasState): EscapeTarget | null {
  if (state.touring) return "tour";
  if (state.panel === "numbers") return "numbers";
  if (state.subject.kind === "place") return "place";
  if (state.panel === "places") return "places";
  if (state.subject.kind === "journey") return "journey";
  return null;
}
const none: Subject = { kind: "none" };
const wrapLongitude = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
const sameSubject = (a: Subject, b: Subject) =>
  a.kind === b.kind && (a.kind === "none" || a.id === (b as typeof a).id);
function subjectOf(route: Route, catalog: Catalog): Subject {
  const place = route.place ? catalog.resolvePlace(route.place) : undefined;
  if (place) return { kind: "place", id: place };
  if (route.journey && catalog.hasJourney(route.journey))
    return { kind: "journey", id: route.journey };
  return none;
}
export function transition(state: AtlasState, action: Action, catalog: Catalog): AtlasState {
  switch (action.type) {
    case "select": {
      const id = catalog.resolvePlace(action.id);
      if (!id) return state;
      // Choosing a place ends the tour and closes whichever panel offered it.
      return { ...state, subject: { kind: "place", id }, panel: "none", touring: false, preview: null };
    }
    case "deselect":
      return state.subject.kind === "none" ? state : { ...state, subject: none };
    case "focusJourney":
      if (!catalog.hasJourney(action.id)) return state;
      return { ...state, subject: { kind: "journey", id: action.id }, panel: "none", touring: false, preview: null };
    case "preview":
      return state.preview === action.id ? state : { ...state, preview: action.id };
    case "filter": {
      const through = action.through !== null && isoDate.test(action.through) ? action.through : null;
      if (through === state.timeline.through && action.mode === state.timeline.mode) return state;
      return { ...state, timeline: { through, mode: action.mode } };
    }
    case "togglePanel":
      // One panel at a time; a hover preview never outlives the directory.
      return { ...state, panel: state.panel === action.panel ? "none" : action.panel, preview: null };
    case "closePanel":
      return state.panel === action.panel ? { ...state, panel: "none", preview: null } : state;
    case "playTour":
      if (state.touring) return state;
      return { ...state, touring: true, subject: none, preview: null };
    case "stopTour":
      return state.touring ? { ...state, touring: false } : state;
    case "reset":
      return { ...state, subject: none, camera: { kind: "home" }, touring: false, preview: null };
    case "moved": {
      const camera: Camera =
        action.camera.kind === "home"
          ? action.camera
          : {
              kind: "moved",
              zoom: Math.min(24, Math.max(0, action.camera.zoom)),
              lat: Math.min(90, Math.max(-90, action.camera.lat)),
              lng: wrapLongitude(action.camera.lng),
            };
      return { ...state, camera };
    }
    case "escape":
      switch (escapeTarget(state)) {
        case "tour":
          return { ...state, touring: false };
        case "numbers":
        case "places":
          return { ...state, panel: "none", preview: null };
        case "place":
        case "journey":
          return { ...state, subject: none };
        case null:
          return state;
      }
      return state;
    case "chooseTheme":
    case "systemTheme":
      return state.theme === action.theme ? state : { ...state, theme: action.theme };
    case "route": {
      const { route } = action;
      const subject = subjectOf(route, catalog);
      const timeline: Timeline = { through: route.through ?? null, mode: route.mode ?? "cumulative" };
      const navigated = subject.kind !== "none" && !sameSubject(subject, state.subject);
      return {
        ...state,
        subject,
        // A place or journey link frames its subject; the camera is the map's to report.
        camera: route.view ? { kind: "moved", ...route.view } : subject.kind === "none" ? { kind: "home" } : state.camera,
        timeline:
          timeline.through === state.timeline.through && timeline.mode === state.timeline.mode
            ? state.timeline
            : timeline,
        panel: route.panel ?? "none",
        touring: navigated ? false : state.touring,
        preview: null,
      };
    }
  }
}
/** The state as a route: what a link carries. Theme, tour and hover stay with the viewer. */
export function toRoute(state: AtlasState): Route {
  const { subject, camera, timeline, panel } = state;
  return {
    ...(subject.kind === "place" ? { place: subject.id } : {}),
    ...(subject.kind === "journey" ? { journey: subject.id } : {}),
    ...(subject.kind === "none" && camera.kind === "moved"
      ? { view: { zoom: camera.zoom, lat: camera.lat, lng: camera.lng } }
      : {}),
    ...(timeline.through ? { through: timeline.through } : {}),
    ...(timeline.mode === "only" ? { mode: "only" as const } : {}),
    ...(panel !== "none" ? { panel } : {}),
  };
}
/** Whether a link names nothing beyond the opening world view. */
export const isOpeningView = (state: AtlasState) =>
  state.subject.kind === "none" &&
  state.camera.kind === "home" &&
  state.timeline.through === null &&
  state.timeline.mode === "cumulative";
