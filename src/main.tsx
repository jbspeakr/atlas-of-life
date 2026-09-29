import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createMap,
  homes,
  isMissingTile,
  places,
  trips,
  visits,
  visitsByPlace,
} from "./map/create-map";
import type { Atlas } from "./map/create-map";
import { fold } from "./map/text";
import { applyTheme, currentTheme, followSystem, type Theme } from "./theme";
import { captionGeography } from "./map/caption";
import { dateBounds, isDated, nights, visibleAt } from "./map/time";
import type { TimeMode } from "./map/time";
import regionLabelsData from "./generated/region-labels.json";
import statsData from "./generated/stats.json";
import {
  archiveSaved,
  offlineSupported,
  registerServiceWorker,
  removeArchive,
  saveArchive,
} from "./map/offline";
import type { Stats } from "../scripts/stats";
const stats = statsData as unknown as Stats;
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
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(0)} MB`;
const narrow = matchMedia("(max-width: 700px)").matches;
const coarse = matchMedia("(pointer: coarse)");
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
const years = [
  ...visits.flatMap((v) => [v.date, ...(v.dateRange ?? [])]),
  ...homes.map((home) => home.since),
]
  .filter((s): s is string => Boolean(s))
  .map((s) => Number(s.slice(0, 4)));
const firstYear = Math.min(...years, new Date().getUTCFullYear());
const lastYear = Math.max(...years, firstYear);
// One scrubber position per distinct first-visit date, plus the day each home
// began, so the atlas opens at home; the last position means every visit.
const positions = [
  ...new Set([
    ...visits.filter(isDated).map((visit) => dateBounds(visit)[0]),
    ...homes.flatMap((home) => (home.since ? [home.since] : [])),
  ]),
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
const homeById = new Map(homes.map((home) => [home.id, home]));
const placeById = new Map(places.map((place) => [place.id, place]));
/** Nights spent at each stop within the journey's dates, for the itinerary strip. */
const stopNights = new Map(
  trips.map((trip) => [
    trip.id,
    trip.stops.map((stop) =>
      (visitsByPlace.get(stop) ?? [])
        .filter((visit) => {
          const [start, end] = dateBounds(visit);
          return start <= trip.end && end >= trip.start;
        })
        .reduce((total, visit) => total + (nights(visit) ?? 0), 0),
    ),
  ]),
);
const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`;
function roundTrip(trip: (typeof trips)[number]): string | undefined {
  const from = trip.from ? homeById.get(trip.from) : undefined;
  const to = trip.to ? homeById.get(trip.to) : undefined;
  if (from && to && from.id === to.id) return `Round trip from ${from.label}`;
  if (from && to) return `From ${from.label}, back to ${to.label}`;
  if (from) return `From ${from.label}`;
  if (to) return `Back to ${to.label}`;
  return undefined;
}
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
  const explorerClose = useRef<HTMLButtonElement>(null);
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
  const [statsOpen, setStatsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [offline, setOffline] = useState<
    { state: "unavailable" } | { state: "absent" } | { state: "saving"; received: number; total: number } | { state: "saved"; bytes: number } | { state: "error"; message: string }
  >({ state: "unavailable" });
  const offlineAbort = useRef<AbortController | null>(null);
  const statsButton = useRef<HTMLButtonElement>(null);
  const statsClose = useRef<HTMLButtonElement>(null);
  const place = places.find((p) => p.id === selected);
  const home = selected ? homeById.get(selected) : undefined;
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  useEffect(() => {
    const label = place?.label ?? (home ? `${home.label}, home` : undefined);
    document.title = label ? `${label} · ${siteTitle}` : siteTitle;
  }, [place, home]);
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
          setStatsOpen(false);
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
        // The theme may have changed while the style was loading.
        value.setTheme(currentTheme());
        if (value.archive.bundled && offlineSupported() && !deterministic)
          void archiveSaved(value.archive.url).then((bytes) =>
            setOffline(bytes === null ? { state: "absent" } : { state: "saved", bytes }),
          );
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
  }, []);
  useEffect(() => followSystem(setTheme), []);
  useEffect(() => {
    atlas.current?.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (place || home) closeButton.current?.focus({ preventScroll: true });
  }, [place, home]);
  // A hover preview never outlives the directory entry that started it.
  useEffect(() => {
    atlas.current?.preview(null);
  }, [explorerOpen, scope]);
  useEffect(() => {
    if (!explorerOpen) return;
    // On touch screens, focusing the search field would raise the keyboard
    // over the sheet before the viewer asked to type; it opens on a tap instead.
    if (coarse.matches) explorerClose.current?.focus({ preventScroll: true });
    else searchInput.current?.focus({ preventScroll: true });
  }, [explorerOpen]);
  useEffect(() => {
    if (statsOpen) statsClose.current?.focus({ preventScroll: true });
  }, [statsOpen]);
  function closeStats() {
    setStatsOpen(false);
    statsButton.current?.focus({ preventScroll: true });
  }
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
        } else if (statsOpen) {
          closeStats();
        } else if (selected) {
          dismiss();
        } else if (explorerOpen) {
          setExplorerOpen(false);
          browseButton.current?.focus({ preventScroll: true });
        } else {
          // A journey focused from the directory lets go too.
          atlas.current?.deselect();
        }
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [selected, explorerOpen, touring, statsOpen]);
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
        <button
          ref={statsButton}
          type="button"
          className="atlas-count"
          aria-expanded={statsOpen}
          aria-controls="atlas-stats"
          aria-label="By the numbers"
          onClick={() => {
            setExplorerOpen(false);
            setStatsOpen(!statsOpen);
          }}
        >
          {stats.countries} countries{" "}
          <span aria-hidden="true">·</span> {stats.places} places{" "}
          <span aria-hidden="true">·</span> {firstYear}–{lastYear}
        </button>
      </header>
      {statsOpen && (
        <section className="atlas-stats" id="atlas-stats" aria-label="By the numbers">
          <div className="explorer-heading">
            <h2>By the numbers</h2>
            <button ref={statsClose} type="button" className="icon-button" aria-label="Close numbers"
              onClick={closeStats}>×</button>
          </div>
          <dl className="stats-totals">
            <div><dt>Countries</dt><dd>{stats.countries}</dd></div>
            <div><dt>Regions</dt><dd>{stats.regions}</dd></div>
            <div><dt>Places</dt><dd>{stats.places}</dd></div>
            <div><dt>Visits</dt><dd>{stats.visits}</dd></div>
            <div><dt>Journeys</dt><dd>{stats.journeys}</dd></div>
            <div><dt>Nights away</dt><dd>{stats.nights}</dd></div>
          </dl>
          {homes.map((entry) => (
            <p className="stats-note" key={entry.id}>
              Home <em>{entry.label}</em>
              {entry.since ? `, since ${formatMonth(entry.since)}` : ""}
              {entry.until ? ` until ${formatMonth(entry.until)}` : ""}
            </p>
          ))}
          {stats.longestStay && (
            <p className="stats-note">
              Longest stay <em>{stats.longestStay.label}</em>, {stats.longestStay.nights} nights
            </p>
          )}
          {stats.years.length > 0 && (
            <table className="stats-years">
              <caption>Nights away by year</caption>
              <thead>
                <tr><th scope="col">Year</th><th scope="col">Visits</th><th scope="col">Nights</th></tr>
              </thead>
              <tbody>
                {stats.years.map((row) => {
                  const most = Math.max(1, ...stats.years.map((y) => y.nights));
                  return (
                    <tr key={row.year}>
                      <th scope="row">{row.year}</th>
                      <td>{row.visits}</td>
                      <td>
                        <span className="stats-bar" aria-hidden="true">
                          <i style={{ width: `${(row.nights / most) * 100}%` }} />
                        </span>
                        {row.nights}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <table className="stats-countries">
            <caption>Places by country</caption>
            <thead>
              <tr><th scope="col">Country</th><th scope="col">Places</th><th scope="col">First</th></tr>
            </thead>
            <tbody>
              {stats.byCountry.map((row) => (
                <tr key={row.country}>
                  <th scope="row">{countryNames.of(row.country) ?? row.country}</th>
                  <td>{row.places}</td>
                  <td>{row.firstYear ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
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
        <button
          type="button"
          className="theme-button"
          aria-label={theme === "dark" ? "Switch to the day theme" : "Switch to the night theme"}
          title={theme === "dark" ? "Day theme" : "Night theme"}
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            applyTheme(next, true);
            setTheme(next);
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
      <aside className="place-browser" aria-label="Places">
        <button
          ref={browseButton}
          className="browse-toggle"
          type="button"
          aria-label="Browse places"
          aria-expanded={explorerOpen}
          aria-controls="place-explorer"
          onClick={() => {
            setStatsOpen(false);
            setExplorerOpen(!explorerOpen);
          }}
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
              <button ref={explorerClose} type="button" className="icon-button" aria-label="Close places"
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
              placeholder="Search city, region or country" enterKeyHint="search"
              autoComplete="off" autoCorrect="off" spellCheck={false}
              value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              onKeyDown={(event) => {
                // Search lowers the on-screen keyboard so the results are in reach.
                if (event.key === "Enter" && coarse.matches) event.currentTarget.blur();
              }} />
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
                      onMouseEnter={() => atlas.current?.preview(trip.id)}
                      onMouseLeave={() => atlas.current?.preview(null)}
                      onFocus={() => atlas.current?.preview(trip.id)}
                      onBlur={() => atlas.current?.preview(null)}
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
          {membership && (() => {
            const trip = membership.trip;
            const from = trip.from ? homeById.get(trip.from) : undefined;
            const to = trip.to ? homeById.get(trip.to) : undefined;
            const perStop = stopNights.get(trip.id) ?? [];
            const total = perStop.reduce((a, b) => a + b, 0);
            const summary = [roundTrip(trip), total ? plural(total, "night") : undefined]
              .filter(Boolean)
              .join(" · ");
            return (
              <div className="itinerary">
                {summary && <p className="itinerary-summary">{summary}</p>}
                {/* Segment widths follow nights stayed: a schematic, never geography. */}
                <ol className="itinerary-strip" aria-label="Stops in this journey">
                  {from && <li className="itinerary-home" aria-hidden="true" title={`Home, ${from.label}`} />}
                  {trip.stops.map((stop, index) => {
                    const label = placeById.get(stop)?.label ?? stop;
                    const stay = perStop[index] ?? 0;
                    const detail = `${index + 1}. ${label}${stay ? `, ${plural(stay, "night")}` : ""}`;
                    return (
                      <li key={`${stop}-${index}`} style={{ flexGrow: Math.max(1, stay) }}>
                        <button type="button" tabIndex={-1} title={detail} aria-label={detail}
                          aria-current={index === sequenceIndex ? "step" : undefined}
                          onClick={() => atlas.current?.select(stop)} />
                      </li>
                    );
                  })}
                  {to && <li className="itinerary-home" aria-hidden="true" title={`Home, ${to.label}`} />}
                </ol>
              </div>
            );
          })()}
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
      {home && (
        <section
          className="place-caption home-caption"
          role="dialog"
          aria-label="Home"
          aria-describedby="place-geography"
        >
          <button
            className="dismiss"
            ref={closeButton}
            type="button"
            aria-label="Close home label"
            onClick={dismiss}
          >
            ×
          </button>
          <p className="caption-kicker">Home</p>
          <h2>{home.label}</h2>
          <p id="place-geography">{countryNames.of(home.country) ?? home.country}</p>
          {home.since && (
            <p className="visit-dates">
              Since {dateFormatter.format(new Date(`${home.since}T00:00:00Z`))}
              {home.until && <> — {dateFormatter.format(new Date(`${home.until}T00:00:00Z`))}</>}
            </p>
          )}
          {(() => {
            const departures = trips.filter((trip) => trip.from === home.id).length;
            return departures > 0 ? (
              <p className="caption-count">Where {plural(departures, "journey")} began</p>
            ) : null;
          })()}
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
          {offline.state !== "unavailable" && (
            <p className="offline" role="status">
              {offline.state === "absent" && (
                <button type="button" onClick={() => {
                  const url = atlas.current?.archive.url;
                  if (!url) return;
                  const abort = new AbortController();
                  offlineAbort.current = abort;
                  setOffline({ state: "saving", received: 0, total: 0 });
                  saveArchive(url, (received, total) => setOffline({ state: "saving", received, total }), abort.signal)
                    .then((bytes) => setOffline({ state: "saved", bytes }))
                    .catch((error: unknown) =>
                      setOffline(abort.signal.aborted ? { state: "absent" } : { state: "error", message: error instanceof Error ? error.message : String(error) }));
                }}>Save the map for offline use</button>
              )}
              {offline.state === "saving" && (
                <>
                  Saving map… {megabytes(offline.received)}{offline.total ? ` of ${megabytes(offline.total)}` : ""}{" "}
                  <button type="button" onClick={() => offlineAbort.current?.abort()}>Cancel</button>
                </>
              )}
              {offline.state === "saved" && (
                <>
                  Map saved for offline use ({megabytes(offline.bytes)}){" "}
                  <button type="button" onClick={() => {
                    const url = atlas.current?.archive.url;
                    if (url) void removeArchive(url).then(() => setOffline({ state: "absent" }));
                  }}>Remove</button>
                </>
              )}
              {offline.state === "error" && (
                <>
                  Could not save the map: {offline.message}{" "}
                  <button type="button" onClick={() => setOffline({ state: "absent" })}>Dismiss</button>
                </>
              )}
            </p>
          )}
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
          : home
            ? `Home, ${home.label}, ${countryNames.of(home.country)}.`
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
