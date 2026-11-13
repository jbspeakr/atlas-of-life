import { toRoute, type Action } from "./atlas-state";
import { formatHash, parseHash } from "./router";
import type { Store } from "./store";
/** Navigations a viewer would expect Back to undo; every other change replaces the entry. */
const pushes = new Set<Action["type"]>(["select", "focusJourney"]);
/**
 * Keeps the hash equal to the state's route. The page reads it once at start
 * (the caller dispatches the first route) and again whenever the hash changes
 * under it; a link to an alias becomes its canonical form in place.
 */
export function bindUrl(store: Store): () => void {
  const write = (method: "push" | "replace") => {
    const hash = formatHash(toRoute(store.getState()));
    if (hash === location.hash) return;
    const url = location.pathname + location.search + hash;
    if (method === "push") history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  };
  const unsubscribe = store.subscribe((_state, _previous, action) =>
    write(pushes.has(action.type) ? "push" : "replace"),
  );
  const route = () => store.dispatch({ type: "route", route: parseHash(location.hash) });
  window.addEventListener("hashchange", route);
  return () => {
    unsubscribe();
    window.removeEventListener("hashchange", route);
  };
}
