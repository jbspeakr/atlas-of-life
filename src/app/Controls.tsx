import type { Atlas } from "../map/create-map";
import { useAtlas, useStore } from "../state/store";
/** World, tour, zoom and theme. Zoom nudges the camera, which is the map's, not state. */
export function Controls({ atlas }: { atlas: Atlas | null }) {
  const store = useStore();
  const touring = useAtlas((state) => state.touring);
  const theme = useAtlas((state) => state.theme);
  return (
    <nav className="navigation" aria-label="Map controls">
      <button
        type="button"
        aria-label="Back to the world"
        aria-keyshortcuts="Alt+W"
        title="Back to the world (Alt+W)"
        onClick={() => store.dispatch({ type: "reset" })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <ellipse cx="12" cy="12" rx="3.5" ry="8" />
          <path d="M4 12h16" />
        </svg>
        World <kbd>⌥ W</kbd>
      </button>
      <button
        type="button"
        className="tour-button"
        aria-pressed={touring}
        aria-label={touring ? "Stop the tour" : "Play a tour of the atlas"}
        title={touring ? "Stop the tour (Escape)" : "Play a 24-second tour"}
        onClick={() => store.dispatch({ type: touring ? "stopTour" : "playTour" })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {touring ? <rect x="7" y="7" width="10" height="10" /> : <path d="M8 5.5v13l10-6.5z" />}
        </svg>
        {touring ? "Stop" : "Tour"}
      </button>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom in"
        aria-keyshortcuts="+"
        title="Zoom in (+)"
        onClick={() => atlas?.zoomBy(1)}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-button"
        aria-label="Zoom out"
        aria-keyshortcuts="-"
        title="Zoom out (−)"
        onClick={() => atlas?.zoomBy(-1)}
      >
        −
      </button>
      <button
        type="button"
        className="theme-button"
        aria-label={theme === "dark" ? "Switch to the day theme" : "Switch to the night theme"}
        title={theme === "dark" ? "Day theme" : "Night theme"}
        onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          store.dispatch({ type: "chooseTheme", theme: next });
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {theme === "dark" ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
            </>
          ) : (
            <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />
          )}
        </svg>
      </button>
    </nav>
  );
}
