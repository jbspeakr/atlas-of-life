import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createMap,
  places,
  visits,
  visitsByPlace,
} from "./map/create-map";
import type { Atlas } from "./map/create-map";
import regionLabelsData from "./generated/region-labels.json";
const regionLabels: Record<string, string> = regionLabelsData;
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
import "./styles/map.css";
import "./styles/tokens.css";
import "./styles/app.css";
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const years = visits.flatMap((v) =>
  [v.date, ...(v.dateRange ?? [])]
    .filter((s): s is string => Boolean(s))
    .map((s) => Number(s.slice(0, 4))),
);
const firstYear = Math.min(...years, new Date().getUTCFullYear());
const lastYear = Math.max(...years, firstYear);
const chronology = [...places].sort(
  (a, b) =>
    (a.date ?? a.dateRange?.[0] ?? "9999").localeCompare(
      b.date ?? b.dateRange?.[0] ?? "9999",
    ) || a.id.localeCompare(b.id),
);
const pageSize = 6;
const searchablePlaces = chronology.map((place) => ({
  ...place,
  countryName: countryNames.of(place.country) ?? place.country,
  searchText: [
    place.label,
    countryNames.of(place.country),
    place.region ? regionLabels[place.region] : "",
  ].join(" ").toLocaleLowerCase(),
  firstVisit: Math.min(...(visitsByPlace.get(place.id) ?? []).map((visit) => {
    const date = visit.date ?? visit.dateRange?.[0];
    return date ? Number(date.slice(0, 4)) : -Infinity;
  })),
}));
function App() {
  const host = useRef<HTMLDivElement>(null);
  const atlas = useRef<Atlas | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [scope, setScope] = useState<"view" | "all">("view");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [year, setYear] = useState(lastYear);
  const [view, setView] = useState(
    "The world, with visited countries illuminated.",
  );
  const [zoom, setZoom] = useState(1.8);
  const [error, setError] = useState("");
  const place = places.find((p) => p.id === selected);
  useEffect(() => {
    if (!host.current) return;
    const abort = new AbortController();
    let controller: Atlas | undefined;
    void createMap(
      host.current,
      (id) => {
        if (id) {
          origin.current = document.activeElement as HTMLElement | null;
          setExplorerOpen(false);
        }
        setSelected(id);
      },
      (message, z, ids) => {
        setView(message);
        setZoom(z);
        setVisibleIds(ids);
        setPage(0);
      },
      abort.signal,
    )
      .then((value) => {
        if (abort.signal.aborted) {
          value.destroy();
          return;
        }
        controller = value;
        atlas.current = value;
        value.map.on("error", (event) =>
          setError(
            "The map could not load its geographic data. " +
              event.error.message,
          ),
        );
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(String(error));
      });
    return () => {
      abort.abort();
      controller?.destroy();
    };
  }, []);
  useEffect(() => {
    if (place) closeButton.current?.focus({ preventScroll: true });
  }, [place]);
  useEffect(() => {
    if (explorerOpen) searchInput.current?.focus({ preventScroll: true });
  }, [explorerOpen]);
  function restoreFocus() {
    const target = origin.current?.isConnected ? origin.current : browseButton.current;
    target?.focus({ preventScroll: true });
  }
  function dismiss() {
    setSelected(null);
    history.replaceState(null, "", location.pathname + location.search);
    restoreFocus();
  }
  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const target = event.target;
      const editing = target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.altKey && event.code === "KeyW" && !event.ctrlKey &&
        !event.metaKey && !event.shiftKey && !editing && !event.repeat) {
        event.preventDefault();
        atlas.current?.reset();
      } else if (event.key === "Escape") {
        if (selected) {
          setSelected(null);
          history.replaceState(null, "", location.pathname + location.search);
          restoreFocus();
        } else if (explorerOpen) {
          setExplorerOpen(false);
          browseButton.current?.focus({ preventScroll: true });
        }
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [selected, explorerOpen]);
  const eligiblePlaces = useMemo(
    () => searchablePlaces.filter((place) => place.firstVisit <= year),
    [year],
  );
  const inView = useMemo(() => {
    const ids = new Set(visibleIds);
    return eligiblePlaces.filter((place) => ids.has(place.id));
  }, [eligiblePlaces, visibleIds]);
  const results = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return (scope === "view" ? inView : eligiblePlaces)
      .filter((place) => place.searchText.includes(text));
  }, [scope, query, inView, eligiblePlaces]);
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const placeVisits = place ? (visitsByPlace.get(place.id) ?? []) : [];
  return (
    <main className={zoom >= 6.5 ? "atlas atlas-close" : "atlas"}>
      <div ref={host} className="map" aria-label="Interactive world map" />
      <header>
        <h1>Atlas of a Life</h1>
        <p>A little more of the world.</p>
        <div className="atlas-count">
          {new Set(visits.map((v) => v.country)).size} countries{" "}
          <span aria-hidden="true">·</span> {places.length} places{" "}
          <span aria-hidden="true">·</span> {firstYear}–{lastYear}
        </div>
      </header>
      <nav className="navigation" aria-label="Map controls">
        <button
          type="button"
          aria-label="Back to the world"
          aria-keyshortcuts="Alt+W"
          title="Back to the world (Alt+W)"
          onClick={() => atlas.current?.reset()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <ellipse cx="12" cy="12" rx="3.5" ry="8" />
            <path d="M4 12h16" />
          </svg>
          World <kbd>⌥ W</kbd>
        </button>
      </nav>
      <aside className="place-browser" aria-label="Places">
        <button
          ref={browseButton}
          className="browse-toggle"
          type="button"
          aria-label="Browse places"
          aria-expanded={explorerOpen}
          aria-controls="place-explorer"
          onClick={() => setExplorerOpen(!explorerOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6" />
            <path d="m15 15 5 5" />
          </svg>
          Places <span className="browse-context">{inView.length} in view</span>
          <span aria-hidden="true">{explorerOpen ? "−" : "+"}</span>
        </button>
        {explorerOpen && (
          <section className="place-explorer" id="place-explorer" aria-label="Browse places">
            <div className="explorer-heading">
              <h2>Explore places</h2>
              <button type="button" className="icon-button" aria-label="Close places"
                onClick={() => {
                  setExplorerOpen(false);
                  browseButton.current?.focus({ preventScroll: true });
                }}>×</button>
            </div>
            <div className="place-scope" role="group" aria-label="Place scope">
              <button type="button" aria-pressed={scope === "view"}
                onClick={() => { setScope("view"); setPage(0); }}>
                In view <span>{inView.length}</span>
              </button>
              <button type="button" aria-pressed={scope === "all"}
                onClick={() => { setScope("all"); setPage(0); }}>
                All places <span>{eligiblePlaces.length}</span>
              </button>
            </div>
            <input ref={searchInput} type="search" aria-label="Search places"
              placeholder="Search city, region or country"
              value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
            <p className="explorer-context" role="status">
              {results.length} {results.length === 1 ? "place" : "places"}
              {scope === "view" ? " in this map view" : " across the world"}
              {year < lastYear ? ` · through ${year}` : " · all years"}
            </p>
            <ol className="place-results">
              {results.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((p) => (
                <li key={p.id}>
                  <button type="button" data-place-id={p.id}
                    aria-pressed={selected === p.id}
                    onClick={() => atlas.current?.select(p.id)}>
                    <span className="place-mark" aria-hidden="true" />
                    <span className="index-name">{p.label}<small>{p.countryName}</small></span>
                    <span className="index-year">{Number.isFinite(p.firstVisit) ? p.firstVisit : "Undated"}</span>
                  </button>
                </li>
              ))}
            </ol>
            {results.length === 0 && (
              <div className="places-empty">
                <p>{query.trim() ? "No matching places." : "No visits here in this time range."}</p>
                {scope === "view" && <button type="button"
                  onClick={() => { setScope("all"); setPage(0); }}>Search all places</button>}
                {query && <button type="button" onClick={() => { setQuery(""); setPage(0); }}>Clear search</button>}
              </div>
            )}
            {pageCount > 1 && <nav className="place-pages" aria-label="Place pages">
              <button type="button" aria-label="Previous places" disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}>←</button>
              <span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, results.length)} of {results.length}</span>
              <button type="button" aria-label="Next places" disabled={currentPage === pageCount - 1}
                onClick={() => setPage(currentPage + 1)}>→</button>
            </nav>}
            <p className="explorer-hint">Move the map to explore · earliest visits first</p>
          </section>
        )}
      </aside>
      {place && (
        <section
          className="place-caption"
          role="dialog"
          aria-label="Place"
          aria-describedby="place-geography"
        >
          <button
            className="dismiss"
            ref={closeButton}
            type="button"
            aria-label="Close place label"
            onClick={dismiss}
          >
            ×
          </button>
          <h2>{place.label}</h2>
          <p id="place-geography">
            {place.region && (
              <>
                {regionLabels[place.region] ?? place.region}{" "}
                <span aria-hidden="true">/</span>{" "}
              </>
            )}
            {countryNames.of(place.country)}
          </p>
          <p className="visit-dates">
            {placeVisits
              .map((v) =>
                v.date
                  ? dateFormatter.format(new Date(v.date + "T00:00:00Z"))
                  : v.dateRange
                    ? v.dateRange
                        .map((date, i) =>
                          date
                            ? dateFormatter.format(
                                new Date(date + "T00:00:00Z"),
                              )
                            : i
                              ? "onwards"
                              : "Earlier",
                        )
                        .join(" — ")
                    : "",
              )
              .filter(Boolean)
              .join(" · ")}
          </p>
          {place.visitCount > 1 && (
            <p className="caption-count">{place.visitCount} visits</p>
          )}
        </section>
      )}
      <form className="timeline" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="year">
          {year === lastYear ? "All years" : <>Through <output htmlFor="year">{year}</output></>}
        </label>
        <input
          id="year"
          aria-label="Year"
          type="range"
          min={firstYear}
          max={lastYear}
          step="1"
          value={year}
          aria-valuetext={`Through ${Math.floor(year)}`}
          onChange={(e) => {
            const value = Number(e.target.value);
            setYear(value);
            setPage(0);
            atlas.current?.filter(value);
          }}
        />
        <button className="timeline-reset" type="button" aria-label="Show all years"
          title="Show all years" disabled={year === lastYear}
          onClick={() => {
            setYear(lastYear);
            setPage(0);
            atlas.current?.filter(lastYear);
          }}>↺</button>
      </form>
      <details className="attribution">
        <summary>© OpenStreetMap contributors · Map credits</summary>
        <div>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors · ODbL
          </a>
          <a href="https://protomaps.com" target="_blank" rel="noreferrer">
            Protomaps · basemap & style
          </a>
          <a
            href="https://www.geoboundaries.org"
            target="_blank"
            rel="noreferrer"
          >
            geoBoundaries · Runfola et al., 2020 · CC-BY 4.0
          </a>
          <a
            href="https://www.naturalearthdata.com"
            target="_blank"
            rel="noreferrer"
          >
            Natural Earth · public domain
          </a>
        </div>
      </details>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {place
          ? `${place.label}, ${countryNames.of(place.country)}. ${place.visitCount} ${place.visitCount === 1 ? "visit" : "visits"}.`
          : view}
      </p>
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
