import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { trips, visitsByPlace } from "../map/data";
import { fold } from "../map/text";
import { visibleAt } from "../map/time";
import { useAtlas, useStore } from "../state/store";
import { neverSlept, searchablePlaces, searchableTrips } from "./derived";
import { coarse, dateFormatter, narrow, plural } from "./format";
import { timeLabel } from "./Timeline";
const pageSize = 6;
/** What the map last reported about its camera; a new report is a new object. */
export type Viewport = { message: string; zoom: number; visibleIds: string[] };
/** The Places directory: places in view, every place, or journeys, searchable and paged. */
export function Directory({
  browseButton,
  viewport,
}: {
  browseButton: RefObject<HTMLButtonElement | null>;
  viewport: Viewport;
}) {
  const store = useStore();
  const explorerOpen = useAtlas((state) => state.panel === "places");
  const { through, mode } = useAtlas((state) => state.timeline);
  const subject = useAtlas((state) => state.subject);
  const selected = subject.kind === "place" ? subject.id : null;
  const searchInput = useRef<HTMLInputElement>(null);
  const explorerClose = useRef<HTMLButtonElement>(null);
  const [scope, setScopeState] = useState<"view" | "all" | "trips">(narrow ? "all" : "view");
  const [query, setQueryState] = useState("");
  // The page returns to the first whenever the map view or the timeline changes.
  const pageKey = { viewport, through, mode };
  const [paging, setPaging] = useState({ ...pageKey, page: 0 });
  const page =
    paging.viewport === viewport && paging.through === through && paging.mode === mode ? paging.page : 0;
  const setPage = (next: number) => setPaging({ ...pageKey, page: next });
  const setScope = (next: typeof scope) => {
    // A hover preview never outlives the directory entry that started it.
    store.dispatch({ type: "preview", id: null });
    setScopeState(next);
    setPage(0);
  };
  const setQuery = (next: string) => {
    setQueryState(next);
    setPage(0);
  };
  useEffect(() => {
    if (!explorerOpen) return;
    // On touch screens, focusing the search field would raise the keyboard
    // over the sheet before the viewer asked to type; it opens on a tap instead.
    if (coarse.matches) explorerClose.current?.focus({ preventScroll: true });
    else searchInput.current?.focus({ preventScroll: true });
  }, [explorerOpen]);
  const close = () => {
    store.dispatch({ type: "closePanel", panel: "places" });
    browseButton.current?.focus({ preventScroll: true });
  };
  const eligiblePlaces = useMemo(
    () =>
      searchablePlaces.filter((place) =>
        (visitsByPlace.get(place.id) ?? []).some(
          (visit) => visibleAt(visit, through, mode) > 0,
        ),
      ),
    [through, mode],
  );
  const inView = useMemo(() => {
    const ids = new Set(viewport.visibleIds);
    return eligiblePlaces.filter((place) => ids.has(place.id));
  }, [eligiblePlaces, viewport]);
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
  const currentPage = Math.min(page, pageCount - 1);
  return (
  <aside className="place-browser" aria-label="Places">
    <button
      ref={browseButton}
      className="browse-toggle"
      type="button"
      aria-label="Browse places"
      aria-expanded={explorerOpen}
      aria-controls="place-explorer"
      onClick={() => {
        store.dispatch({ type: "togglePanel", panel: "places" });
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
            onClick={close}>×</button>
        </div>
        <div className="place-scope" role="group" aria-label="Place scope">
          <button type="button" aria-pressed={scope === "view"}
            onClick={() => setScope("view")}>
            In view <span>{inView.length}</span>
          </button>
          <button type="button" aria-pressed={scope === "all"}
            onClick={() => setScope("all")}>
            All places <span>{eligiblePlaces.length}</span>
          </button>
          {trips.length > 0 && (
            <button type="button" aria-pressed={scope === "trips"}
              onClick={() => setScope("trips")}>
              Journeys <span>{eligibleTrips.length}</span>
            </button>
          )}
        </div>
        <input ref={searchInput} type="search" aria-label="Search places"
          placeholder="Search city, region or country" enterKeyHint="search"
          autoComplete="off" autoCorrect="off" spellCheck={false}
          value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Search lowers the on-screen keyboard so the results are in reach.
            if (event.key === "Enter" && coarse.matches) event.currentTarget.blur();
          }} />
        <p className="explorer-context" role="status">
          {scope === "trips"
            ? `${tripResults.length} ${tripResults.length === 1 ? "journey" : "journeys"}`
            : `${results.length} ${results.length === 1 ? "place" : "places"}${scope === "view" ? " in this map view" : " across the world"}`}
          {through === null ? " · all visits" : ` · ${timeLabel(through, mode).toLowerCase()}`}
        </p>
        {scope === "trips" && (
          <ol className="place-results">
            {tripResults.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((trip) => (
              <li key={trip.id}>
                <button type="button" data-trip-id={trip.id}
                  onMouseEnter={() => store.dispatch({ type: "preview", id: trip.id })}
                  onMouseLeave={() => store.dispatch({ type: "preview", id: null })}
                  onFocus={() => store.dispatch({ type: "preview", id: trip.id })}
                  onBlur={() => store.dispatch({ type: "preview", id: null })}
                  onClick={() => {
                    store.dispatch({ type: "focusJourney", id: trip.id });
                    browseButton.current?.focus({ preventScroll: true });
                  }}>
                  <span className="place-mark place-mark-route" aria-hidden="true" />
                  <span className="index-name">{trip.label}<small>
                    {dateFormatter.format(new Date(`${trip.start}T00:00:00Z`))} — {dateFormatter.format(new Date(`${trip.end}T00:00:00Z`))}
                  </small></span>
                  <span className="index-year">
                    {trip.stops.length} stops
                    {trip.dayTrips > 0 && <small>{plural(trip.dayTrips, "day trip")}</small>}
                    {trip.onTheWay > 0 && <small>{trip.onTheWay} on the way</small>}
                  </span>
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
                onClick={() => store.dispatch({ type: "select", id: p.id })}>
                <span className={neverSlept(p) ? "place-mark place-mark-hollow" : "place-mark"} aria-hidden="true" />
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
              onClick={() => setScope("all")}>Search all places</button>}
            {query && <button type="button" onClick={() => setQuery("")}>Clear search</button>}
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
  );
}
