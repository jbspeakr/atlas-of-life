import { useEffect, useRef, useState } from "react";
import { isMissingTile, places } from "../map/data";
import type { Atlas } from "../map/create-map";
import { registerServiceWorker } from "../map/offline";
import { escapeTarget } from "../state/atlas-state";
import { useAtlas, useStore } from "../state/store";
import { Caption } from "./Caption";
import { Controls } from "./Controls";
import { Credits } from "./Credits";
import { firstYear, homeById, lastYear, stats } from "./derived";
import { Directory, type Viewport } from "./Directory";
import { countryName, deterministic } from "./format";
import { Numbers } from "./Numbers";
import { Timeline } from "./Timeline";
const siteTitle = document.title;
// The worker's install downloads the whole shell; it waits until the first
// view is drawn so it never competes with the map for bandwidth.
const startOfflineShell = () => {
  if (!deterministic) registerServiceWorker(import.meta.env.BASE_URL);
};
/**
 * A page from before a deploy asks for hashed build files the deploy removed.
 * Reload once to fetch the current build; a second miss is reported instead.
 */
function reloadForStaleBuild(error: unknown): boolean {
  const { url, status } = error as { url?: unknown; status?: unknown };
  if (status !== 404 || typeof url !== "string") return false;
  if (!new URL(url, location.href).pathname.includes("/assets/")) return false;
  try {
    if (sessionStorage.getItem("atlas-stale-build") === url) return false;
    sessionStorage.setItem("atlas-stale-build", url);
  } catch {
    return false;
  }
  location.reload();
  return true;
}
/** The page: the map, every surface around it, and the keyboard and focus rules between them. */
export function App() {
  const store = useStore();
  const host = useRef<HTMLDivElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const statsButton = useRef<HTMLButtonElement>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    message: "The world, with visited countries illuminated.",
    zoom: 1.8,
    visibleIds: [],
  });
  const [error, setError] = useState("");
  const numbersOpen = useAtlas((state) => state.panel === "numbers");
  const subject = useAtlas((state) => state.subject);
  const selected = subject.kind === "place" ? subject.id : null;
  const home = selected ? homeById.get(selected) : undefined;
  const place = home ? undefined : places.find((p) => p.id === selected);
  useEffect(() => {
    const label = place?.label ?? (home ? `${home.label}, home` : undefined);
    document.title = label ? `${label} · ${siteTitle}` : siteTitle;
  }, [place, home]);
  // Closing a place returns focus to where the viewer opened it from, or to
  // Browse places when that control has gone (a directory entry, say).
  useEffect(() => {
    let origin: HTMLElement | null = null;
    return store.subscribe((state, previous) => {
      const was = previous.subject.kind === "place";
      const is = state.subject.kind === "place";
      if (is && !was) origin = document.activeElement as HTMLElement | null;
      if (was && !is) {
        const target = origin?.isConnected ? origin : browseButton.current;
        target?.focus({ preventScroll: true });
        origin = null;
      }
    });
  }, [store]);
  useEffect(() => {
    if (!host.current) return;
    const abort = new AbortController();
    let controller: Atlas | undefined;
    const container = host.current;
    // The map module brings MapLibre with it; importing it here, after the
    // first render, lets the title and controls paint while it downloads.
    void import("../map/create-map")
      .then(({ createMap }) =>
        createMap(
          container,
          store,
          (message, zoom, visibleIds) => setViewport({ message, zoom, visibleIds }),
          abort.signal,
        ),
      )
      .then((value) => {
        if (abort.signal.aborted) {
          value.destroy();
          return;
        }
        controller = value;
        setAtlas(value);
        value.map.once("idle", startOfflineShell);
        value.map.on("error", (event) => {
          // Outside the detail windows the map falls back to coarser tiles.
          if (isMissingTile(event.error)) return;
          if (reloadForStaleBuild(event.error)) return;
          setError(
            "The map could not load its geographic data. " +
              event.error.message,
          );
        });
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        startOfflineShell();
        if (reloadForStaleBuild(error)) return;
        setError(String(error));
      });
    return () => {
      abort.abort();
      controller?.destroy();
    };
  }, [store]);
  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const target = event.target;
      const editing = target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.altKey && event.code === "KeyW" && !event.ctrlKey &&
        !event.metaKey && !event.shiftKey && !editing && !event.repeat) {
        event.preventDefault();
        store.dispatch({ type: "reset" });
      } else if (event.key === "Escape") {
        // The transition decides what closes; focus goes back to what opened it.
        const closing = escapeTarget(store.getState());
        store.dispatch({ type: "escape" });
        if (closing === "numbers") statsButton.current?.focus({ preventScroll: true });
        if (closing === "places") browseButton.current?.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [store]);
  return (
    <main className={viewport.zoom >= 6.5 ? "atlas atlas-close" : "atlas"}>
      <div ref={host} className="map" aria-label="Interactive world map" />
      <header>
        <h1>Atlas of a Life</h1>
        <p>A little more of the world.</p>
        <button
          ref={statsButton}
          type="button"
          className="atlas-count"
          aria-expanded={numbersOpen}
          aria-controls="atlas-stats"
          aria-label="By the numbers"
          onClick={() => store.dispatch({ type: "togglePanel", panel: "numbers" })}
        >
          {stats.countries} countries{" "}
          <span aria-hidden="true">·</span> {stats.places} places{" "}
          <span aria-hidden="true">·</span> {firstYear}–{lastYear}
        </button>
      </header>
      <Numbers opener={statsButton} />
      <Controls atlas={atlas} />
      <Directory browseButton={browseButton} viewport={viewport} />
      <Caption />
      <Timeline />
      <Credits atlas={atlas} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {place
          ? `${place.label}, ${countryName(place.country)}. ${place.visitCount} ${place.visitCount === 1 ? "visit" : "visits"}.`
          : home
            ? `Home, ${home.label}, ${countryName(home.country)}.`
            : viewport.message}
      </p>
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
