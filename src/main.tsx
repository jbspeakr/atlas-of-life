import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createMap,
  places,
  trips,
  visits,
  visitsByPlace,
} from "./map/create-map";
import type { Atlas } from "./map/create-map";
import { fold } from "./map/text";
import { captionGeography } from "./map/caption";
import { dateBounds, isDated, nights, visibleAt } from "./map/time";
import type { TimeMode } from "./map/time";
import regionLabelsData from "./generated/region-labels.json";
const regionLabels: Record<string, string> = regionLabelsData;
const deterministic =
  new URLSearchParams(location.search).get("deterministic") === "1";
const locale = (() => {
  const preferred = deterministic ? "en-GB" : navigator.language || "en-GB";
  try {
    return Intl.DisplayNames.supportedLocalesOf([preferred])[0] ?? "en-GB";
  } catch {
    return "en-GB";
  }
})();
const dateFormatter = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
import "./styles/map.css";
import "./styles/tokens.css";
import "./styles/app.css";
const monthFormatter = new Intl.DateTimeFormat(locale, {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const formatMonth = (date: string) =>
  monthFormatter.format(new Date(`${date}T00:00:00Z`));
const countryNames = new Intl.DisplayNames([locale], { type: "region" });
const siteTitle = document.title;
const narrow = matchMedia("(max-width: 700px)").matches;
const years = visits.flatMap((v) =>
  [v.date, ...(v.dateRange ?? [])]
    .filter((s): s is string => Boolean(s))
    .map((s) => Number(s.slice(0, 4))),
);
const firstYear = Math.min(...years, new Date().getUTCFullYear());
const lastYear = Math.max(...years, firstYear);
// One scrubber position per distinct first-visit date; the last position means every visit.
const positions = [
  ...new Set(visits.filter(isDated).map((visit) => dateBounds(visit)[0])),
].sort();
const chronology = [...places].sort(
  (a, b) =>
    (a.date ?? a.dateRange?.[0] ?? "9999").localeCompare(
      b.date ?? b.dateRange?.[0] ?? "9999",
    ) || a.id.localeCompare(b.id),
);
const pageSize = 6;
const tripByPlace = new Map<string, { trip: (typeof trips)[number]; index: number }>();
for (const trip of trips)
  trip.stops.forEach((stop, index) => {
    if (!tripByPlace.has(stop)) tripByPlace.set(stop, { trip, index });
  });
const searchableTrips = trips.map((trip) => ({
  ...trip,
  searchText: fold(trip.label),
}));
const searchablePlaces = chronology.map((place) => ({
  ...place,
  countryName: countryNames.of(place.country) ?? place.country,
  searchText: fold(
    [
      place.label,
      countryNames.of(place.country),
      place.region ? regionLabels[place.region] : "",
    ].join(" "),
  ),
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
  const [scope, setScope] = useState<"view" | "all" | "trips">(narrow ? "all" : "view");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [through, setThrough] = useState<string | null>(null);
  const [mode, setMode] = useState<TimeMode>("cumulative");
  const [view, setView] = useState(
    "The world, with visited countries illuminated.",
  );
  const [zoom, setZoom] = useState(1.8);
  const [error, setError] = useState("");
  const [touring, setTouring] = useState(false);
  const place = places.find((p) => p.id === selected);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  useEffect(() => {
    document.title = place ? `${place.label} · ${siteTitle}` : siteTitle;
  }, [place]);
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
        } else if (selectedRef.current) restoreFocus();
        setSelected(id);
      },
      (message, z, ids) => {
        setView(message);
        setZoom(z);
        setVisibleIds(ids);
        setPage(0);
      },
      (routedThrough, routedMode) => {
        setThrough(routedThrough);
        setMode(routedMode);
        setPage(0);
      },
      setTouring,
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
    // The controller owns selection and the URL; its callback restores focus.
    if (atlas.current) atlas.current.deselect();
    else {
      setSelected(null);
      restoreFocus();
    }
  }
  function applyFilter(nextThrough: string | null, nextMode: TimeMode) {
    setThrough(nextThrough);
    setMode(nextMode);
    setPage(0);
    atlas.current?.filter(nextThrough, nextMode);
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
        if (touring) {
          atlas.current?.stop();
        } else if (selected) {
          dismiss();
        } else if (explorerOpen) {
          setExplorerOpen(false);
          browseButton.current?.focus({ preventScroll: true });
        }
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [selected, explorerOpen, touring]);
  const eligiblePlaces = useMemo(
    () =>
      searchablePlaces.filter((place) =>
        (visitsByPlace.get(place.id) ?? []).some(
          (visit) => visibleAt(visit, through, mode) > 0,
        ),
      ),
    [through, mode],
  );
  const position = through === null ? positions.length : positions.indexOf(through);
  const timeLabel =
    through === null
      ? "All visits"
      : `${mode === "only" ? "During" : "Through"} ${formatMonth(through)}`;
  const inView = useMemo(() => {
    const ids = new Set(visibleIds);
    return eligiblePlaces.filter((place) => ids.has(place.id));
  }, [eligiblePlaces, visibleIds]);
  const eligibleTrips = useMemo(
    () =>
      searchableTrips.filter((trip) =>
        trip.stops.some((stop) =>
          (visitsByPlace.get(stop) ?? []).some(
            (visit) => visibleAt(visit, through, mode) > 0,
          ),
        ),
      ),
    [through, mode],
  );
  const results = useMemo(() => {
    const text = fold(query);
    return (scope === "view" ? inView : eligiblePlaces)
      .filter((place) => place.searchText.includes(text));
  }, [scope, query, inView, eligiblePlaces]);
  const tripResults = useMemo(() => {
    const text = fold(query);
    return eligibleTrips.filter((trip) => trip.searchText.includes(text));
  }, [query, eligibleTrips]);
  const listed = scope === "trips" ? tripResults.length : results.length;
  const pageCount = Math.max(1, Math.ceil(listed / pageSize));
  // Previous/next step through the journey when the place is part of one, else the chronology.
  const membership = place ? tripByPlace.get(place.id) : undefined;
  const sequence = membership
    ? membership.trip.stops
    : chronology.map((candidate) => candidate.id);
  const sequenceIndex = place ? sequence.indexOf(place.id) : -1;
  const step = (delta: number) => {
    const next = sequence[sequenceIndex + delta];
    if (next) atlas.current?.select(next);
  };
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
        <button
          type="button"
          className="tour-button"
          aria-pressed={touring}
          aria-label={touring ? "Stop the tour" : "Play a tour of the atlas"}
          title={touring ? "Stop the tour (Escape)" : "Play a 24-second tour"}
          onClick={() => (touring ? atlas.current?.stop() : atlas.current?.play())}
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
          onClick={() => atlas.current?.zoomBy(1)}
        >
          +
        </button>
        <button
          type="button"
          className="zoom-button"
          aria-label="Zoom out"
          aria-keyshortcuts="-"
          title="Zoom out (−)"
          onClick={() => atlas.current?.zoomBy(-1)}
        >
          −
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
              {trips.length > 0 && (
                <button type="button" aria-pressed={scope === "trips"}
                  onClick={() => { setScope("trips"); setPage(0); }}>
                  Journeys <span>{eligibleTrips.length}</span>
                </button>
              )}
            </div>
            <input ref={searchInput} type="search" aria-label="Search places"
              placeholder="Search city, region or country"
              value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
            <p className="explorer-context" role="status">
              {scope === "trips"
                ? `${tripResults.length} ${tripResults.length === 1 ? "journey" : "journeys"}`
                : `${results.length} ${results.length === 1 ? "place" : "places"}${scope === "view" ? " in this map view" : " across the world"}`}
              {through === null ? " · all visits" : ` · ${timeLabel.toLowerCase()}`}
            </p>
            {scope === "trips" && (
              <ol className="place-results">
                {tripResults.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((trip) => (
                  <li key={trip.id}>
                    <button type="button" data-trip-id={trip.id}
                      onClick={() => {
                        setExplorerOpen(false);
                        atlas.current?.focusTrip(trip.id);
                        browseButton.current?.focus({ preventScroll: true });
                      }}>
                      <span className="place-mark place-mark-route" aria-hidden="true" />
                      <span className="index-name">{trip.label}<small>
                        {dateFormatter.format(new Date(`${trip.start}T00:00:00Z`))} — {dateFormatter.format(new Date(`${trip.end}T00:00:00Z`))}
                      </small></span>
                      <span className="index-year">{trip.stops.length} stops</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {scope !== "trips" && <ol className="place-results">
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
            </ol>}
            {listed === 0 && (
              <div className="places-empty">
                <p>{query.trim() ? `No matching ${scope === "trips" ? "journeys" : "places"}.` : scope === "trips" ? "No journeys in this time range." : "No visits here in this time range."}</p>
                {scope === "view" && <button type="button"
                  onClick={() => { setScope("all"); setPage(0); }}>Search all places</button>}
                {query && <button type="button" onClick={() => { setQuery(""); setPage(0); }}>Clear search</button>}
              </div>
            )}
            {pageCount > 1 && <nav className="place-pages" aria-label="Place pages">
              <button type="button" aria-label="Previous places" disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}>←</button>
              <span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, listed)} of {listed}</span>
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
          onKeyDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
            if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
            if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
          }}
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
            {(() => {
              const geography = captionGeography(
                place,
                regionLabels,
                countryNames.of(place.country) ?? place.country,
              );
              return (
                <>
                  {geography.region && (
                    <>
                      {geography.region} <span aria-hidden="true">/</span>{" "}
                    </>
                  )}
                  {geography.country}
                </>
              );
            })()}
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
          {placeVisits.some((v) => nights(v)) && (
            <p className="caption-nights">
              {placeVisits
                .map((v) => nights(v))
                .filter((n): n is number => n !== undefined)
                .reduce((a, b) => a + b, 0)}{" "}
              {placeVisits.reduce((a, v) => a + (nights(v) ?? 0), 0) === 1 ? "night" : "nights"}
            </p>
          )}
          {place.visitCount > 1 && (
            <p className="caption-count">{place.visitCount} visits</p>
          )}
          <nav className="caption-steps" aria-label="Journey">
            <button type="button" aria-label={membership ? "Previous stop" : "Previous visit"}
              aria-keyshortcuts="ArrowLeft" disabled={sequenceIndex <= 0}
              onClick={() => step(-1)}>←</button>
            <span>
              {membership
                ? <>Part of <em>{membership.trip.label}</em> · stop {sequenceIndex + 1} of {sequence.length}</>
                : <>Visit {sequenceIndex + 1} of {sequence.length}</>}
            </span>
            <button type="button" aria-label={membership ? "Next stop" : "Next visit"}
              aria-keyshortcuts="ArrowRight" disabled={sequenceIndex >= sequence.length - 1}
              onClick={() => step(1)}>→</button>
          </nav>
        </section>
      )}
      <form className="timeline" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="through">
          {through === null ? "All visits" : (
            <>
              {mode === "only" ? "During" : "Through"}{" "}
              <output htmlFor="through">{formatMonth(through)}</output>
            </>
          )}
        </label>
        <div className="timeline-track">
          <input
            id="through"
            aria-label={mode === "only" ? "Visited during" : "Visited through"}
            type="range"
            min={0}
            max={positions.length}
            step="1"
            value={position < 0 ? positions.length : position}
            aria-valuetext={timeLabel}
            onChange={(e) => {
              const index = Number(e.target.value);
              applyFilter(index >= positions.length ? null : positions[index], mode);
            }}
          />
          <span className="timeline-ticks" aria-hidden="true">
            {positions.map((date, index) => (
              <i
                key={date}
                className={index <= position ? "lit" : undefined}
                style={{ left: `${(index / positions.length) * 100}%` }}
              />
            ))}
          </span>
        </div>
        <div className="timeline-mode" role="group" aria-label="Time mode">
          <button type="button" aria-pressed={mode === "cumulative"}
            title="Everything visited by the selected date"
            onClick={() => applyFilter(through, "cumulative")}>Through</button>
          <button type="button" aria-pressed={mode === "only"}
            title="Only visits under way during the selected month"
            onClick={() => applyFilter(through, "only")}>During</button>
        </div>
        <button className="timeline-reset" type="button" aria-label="Show all visits"
          title="Show all visits" disabled={through === null}
          onClick={() => applyFilter(null, mode)}>↺</button>
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
