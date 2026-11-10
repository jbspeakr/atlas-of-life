import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  escapeTarget,
  initialState,
  isOpeningView,
  toRoute,
  transition,
  type Action,
  type AtlasState,
  type Catalog,
} from "../src/state/atlas-state.ts";
import { formatHash, parseHash } from "../src/state/router.ts";
import { createStore } from "../src/state/store.ts";
// A small fictional atlas: two places, a home, an ID that needs escaping, and
// legacy links that carried a longer digest after the current ID.
const placeIds = ["berlin-2019", "munich-2020", "home-1", "zürich/€-2021"];
const journeyIds = ["trip-2020", "trip 2021/b"];
const catalog: Catalog = {
  resolvePlace: (id) => placeIds.find((place) => id === place || id.startsWith(`${place}-legacy`)),
  hasJourney: (id) => journeyIds.includes(id),
};
const step = (state: AtlasState, action: Action) => transition(state, action, catalog);
const run = (actions: Action[], from = initialState("dark")) => actions.reduce(step, from);
const day = fc
  .integer({ min: 0, max: 20000 })
  .map((n) => new Date(n * 86_400_000).toISOString().slice(0, 10));
const anyId = fc.oneof(
  fc.constantFrom(...placeIds, ...journeyIds, "berlin-2019-legacy0123abcd"),
  fc.string(),
);
const camera = fc.record({
  zoom: fc.double({ min: -2, max: 30, noNaN: true }),
  lat: fc.double({ min: -95, max: 95, noNaN: true }),
  lng: fc.double({ min: -720, max: 720, noNaN: true }),
});
/** Every action a viewer, the map or the address bar can produce, including nonsense. */
const action: fc.Arbitrary<Action> = fc.oneof(
  anyId.map((id) => ({ type: "select" as const, id })),
  fc.constant({ type: "deselect" as const }),
  anyId.map((id) => ({ type: "focusJourney" as const, id })),
  fc.option(anyId, { nil: null }).map((id) => ({ type: "preview" as const, id })),
  fc.record({
    type: fc.constant("filter" as const),
    through: fc.option(fc.oneof(day, fc.string()), { nil: null }),
    mode: fc.constantFrom("cumulative" as const, "only" as const),
  }),
  fc.constantFrom("places" as const, "numbers" as const).map((panel) => ({ type: "togglePanel" as const, panel })),
  fc.constantFrom("places" as const, "numbers" as const).map((panel) => ({ type: "closePanel" as const, panel })),
  fc.constant({ type: "playTour" as const }),
  fc.constant({ type: "stopTour" as const }),
  fc.constant({ type: "reset" as const }),
  fc.oneof(
    fc.constant({ type: "moved" as const, camera: { kind: "home" as const } }),
    camera.map((c) => ({ type: "moved" as const, camera: { kind: "moved" as const, ...c } })),
  ),
  fc.constant({ type: "escape" as const }),
  fc.constantFrom("dark" as const, "light" as const).map((theme) => ({ type: "chooseTheme" as const, theme })),
  fc.constantFrom("dark" as const, "light" as const).map((theme) => ({ type: "systemTheme" as const, theme })),
  fc.string().map((hash) => ({ type: "route" as const, route: parseHash(hash) })),
);
const reachable = fc.array(action, { maxLength: 40 }).map((actions) => run(actions));
/** What a link must carry: the subject, the moved camera to link precision, the timeline and the panel. */
const linkable = (state: AtlasState) => formatHash(toRoute(state));
describe("state transitions", () => {
  it("selects a place by ID or legacy alias, closing panels and ending the tour", () => {
    const state = run([
      { type: "togglePanel", panel: "places" },
      { type: "playTour" },
      { type: "select", id: "berlin-2019-legacy0123abcd" },
    ]);
    expect(state.subject).toEqual({ kind: "place", id: "berlin-2019" });
    expect(state.panel).toBe("none");
    expect(state.touring).toBe(false);
  });
  it("ignores an unknown place or journey", () => {
    const before = run([{ type: "select", id: "munich-2020" }]);
    expect(step(before, { type: "select", id: "atlantis" })).toBe(before);
    expect(step(before, { type: "focusJourney", id: "nowhere" })).toBe(before);
  });
  it("keeps one panel open at a time and drops a hover preview with it", () => {
    let state = run([{ type: "togglePanel", panel: "places" }, { type: "preview", id: "trip-2020" }]);
    expect(state.preview).toBe("trip-2020");
    state = step(state, { type: "togglePanel", panel: "numbers" });
    expect(state.panel).toBe("numbers");
    expect(state.preview).toBeNull();
    expect(step(state, { type: "togglePanel", panel: "numbers" }).panel).toBe("none");
    expect(step(state, { type: "closePanel", panel: "places" })).toBe(state);
  });
  it("closes the innermost layer on each Escape: tour, numbers, place, directory, journey", () => {
    // A journey focused from the directory, the directory reopened, a place
    // chosen and the numbers opened over it, then the tour: five layers.
    let state = run([
      { type: "focusJourney", id: "trip-2020" },
      { type: "select", id: "munich-2020" },
      { type: "togglePanel", panel: "numbers" },
    ]);
    state = { ...state, touring: true, panel: "numbers" };
    const closed: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      closed.push(escapeTarget(state));
      state = step(state, { type: "escape" });
    }
    expect(closed).toEqual(["tour", "numbers", "place", null]);
    const journey = run([
      { type: "focusJourney", id: "trip-2020" },
      { type: "togglePanel", panel: "places" },
    ]);
    expect(escapeTarget(journey)).toBe("places");
    const afterDirectory = step(journey, { type: "escape" });
    expect(escapeTarget(afterDirectory)).toBe("journey");
    expect(step(afterDirectory, { type: "escape" }).subject).toEqual({ kind: "none" });
  });
  it("reset returns to the opening view but keeps the timeline and theme", () => {
    const state = run([
      { type: "filter", through: "2021-05-01", mode: "only" },
      { type: "chooseTheme", theme: "light" },
      { type: "moved", camera: { kind: "moved", zoom: 5, lat: 50, lng: 10 } },
      { type: "focusJourney", id: "trip-2020" },
      { type: "reset" },
    ]);
    expect(state.subject).toEqual({ kind: "none" });
    expect(state.camera).toEqual({ kind: "home" });
    expect(state.timeline).toEqual({ through: "2021-05-01", mode: "only" });
    expect(state.theme).toBe("light");
  });
  it("rejects a timeline position that is not a date", () => {
    expect(run([{ type: "filter", through: "yesterday", mode: "cumulative" }]).timeline.through).toBeNull();
  });
  it("normalises a reported camera onto the globe", () => {
    const state = run([{ type: "moved", camera: { kind: "moved", zoom: 30, lat: 95, lng: 190 } }]);
    expect(state.camera).toEqual({ kind: "moved", zoom: 24, lat: 90, lng: -170 });
  });
  it("routes links to journeys and panels, and canonicalises aliases", () => {
    const state = run([{ type: "route", route: parseHash("#/journey/trip%202021%2Fb?panel=numbers&through=2021-01-01") }]);
    expect(state.subject).toEqual({ kind: "journey", id: "trip 2021/b" });
    expect(state.panel).toBe("numbers");
    expect(linkable(state)).toBe("#/journey/trip%202021%2Fb?through=2021-01-01&panel=numbers");
    const alias = run([{ type: "route", route: parseHash("#/place/berlin-2019-legacy0123abcd") }]);
    expect(linkable(alias)).toBe("#/place/berlin-2019");
    expect(isOpeningView(run([{ type: "route", route: parseHash("#?panel=places") }]))).toBe(true);
    expect(isOpeningView(run([{ type: "route", route: parseHash("#/place/nowhere") }]))).toBe(true);
  });
  it("every reachable state survives the trip through the URL", () => {
    fc.assert(
      fc.property(reachable, reachable, (state, elsewhere) => {
        // Open the state's link from any other state, as Back, Forward or a pasted link would.
        const hash = linkable(state);
        const arrived = step(elsewhere, { type: "route", route: parseHash(hash) });
        expect(linkable(arrived)).toBe(hash);
        expect(arrived.subject).toEqual(state.subject);
        expect(arrived.timeline).toEqual(state.timeline);
        expect(arrived.panel).toBe(state.panel);
        if (state.subject.kind === "none" && state.camera.kind === "moved") {
          expect(arrived.camera.kind).toBe("moved");
          if (arrived.camera.kind !== "moved") return;
          expect(Math.abs(arrived.camera.zoom - state.camera.zoom)).toBeLessThanOrEqual(0.005);
          expect(Math.abs(arrived.camera.lat - state.camera.lat)).toBeLessThanOrEqual(0.00005);
          expect(Math.abs(arrived.camera.lng - state.camera.lng)).toBeLessThanOrEqual(0.00005);
        }
        // Theme, tour and hover belong to the viewer, not the link.
        expect(arrived.theme).toBe(elsewhere.theme);
        expect(arrived.preview).toBeNull();
      }),
      { numRuns: 500 },
    );
  });
  it("keeps its invariants on every reachable state", () => {
    fc.assert(
      fc.property(reachable, action, (state, next) => {
        // Every subject is one the catalog knows, under its canonical ID.
        if (state.subject.kind === "place") expect(placeIds).toContain(state.subject.id);
        if (state.subject.kind === "journey") expect(journeyIds).toContain(state.subject.id);
        if (state.timeline.through !== null) expect(state.timeline.through).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Navigating to something always ends the tour and closes the panels.
        const after = step(state, next);
        if ((next.type === "select" || next.type === "focusJourney") && after !== state) {
          expect(after.touring).toBe(false);
          expect(after.panel).toBe("none");
        }
        // Escape only ever closes; enough presses always reach a quiet page.
        let quiet = state;
        for (let i = 0; i < 5; i++) {
          const pressed = step(quiet, { type: "escape" });
          expect(pressed.panel === "none" || pressed.panel === quiet.panel).toBe(true);
          expect(pressed.touring && !quiet.touring).toBe(false);
          quiet = pressed;
        }
        expect(escapeTarget(quiet)).toBeNull();
        expect(quiet.subject.kind).toBe("none");
      }),
      { numRuns: 500 },
    );
  });
});
describe("store", () => {
  it("notifies only on change, and runs a listener's dispatch after every listener saw the first", () => {
    const store = createStore(initialState("dark"), catalog);
    const seen: string[] = [];
    store.subscribe((_state, _previous, action) => {
      seen.push(`a:${action.type}`);
      if (action.type === "select") store.dispatch({ type: "togglePanel", panel: "numbers" });
    });
    store.subscribe((_state, _previous, action) => seen.push(`b:${action.type}`));
    store.dispatch({ type: "deselect" });
    store.dispatch({ type: "select", id: "munich-2020" });
    expect(seen).toEqual(["a:select", "b:select", "a:togglePanel", "b:togglePanel"]);
    expect(store.getState().panel).toBe("numbers");
  });
});
