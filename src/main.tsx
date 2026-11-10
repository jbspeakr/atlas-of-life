import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initialState } from "./state/atlas-state";
import { atlasCatalog } from "./state/catalog";
import { parseHash } from "./state/router";
import { createStore, StoreContext } from "./state/store";
import { bindUrl } from "./state/url";
import { applyTheme, currentTheme, followSystem } from "./theme";
import "./styles/map.css";
import "./styles/tokens.css";
import "./styles/app.css";
// The on-screen keyboard shrinks only the visual viewport. Publish how much of
// the layout viewport it covers so the places sheet can sit just above it.
const viewport = window.visualViewport;
function trackKeyboard() {
  if (!viewport) return;
  const root = document.documentElement;
  const inset = Math.max(0, root.clientHeight - viewport.height - viewport.offsetTop);
  root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
  root.style.setProperty("--visible-height", `${Math.round(viewport.height)}px`);
}
viewport?.addEventListener("resize", trackKeyboard);
viewport?.addEventListener("scroll", trackKeyboard);
trackKeyboard();
// One store for the page. The URL, the theme and (once loaded) the map follow it.
const store = createStore(initialState(currentTheme()), atlasCatalog);
bindUrl(store);
store.subscribe((state, previous, action) => {
  if (state.theme !== previous.theme) applyTheme(state.theme, action.type === "chooseTheme");
});
followSystem((theme) => store.dispatch({ type: "systemTheme", theme }));
// The opening link becomes state; an alias is rewritten to its canonical form.
store.dispatch({ type: "route", route: parseHash(location.hash) });
createRoot(document.getElementById("root")!).render(
  <StoreContext value={store}>
    <App />
  </StoreContext>,
);
