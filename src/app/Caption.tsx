import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { places, trips, visitsByPlace, type PublicVisit } from "../map/data";
import { captionGeography } from "../map/caption";
import { nights } from "../map/time";
import { useAtlas, useStore } from "../state/store";
import {
  baseLabel,
  chronology,
  dayTripPlaces,
  homeById,
  itineraries,
  placeById,
  regionLabels,
  roundTrip,
  stopNights,
  tripByPlace,
  tripDayTrips,
  tripVia,
  viaPlaces,
} from "./derived";
import { countryName, dateFormatter, plural } from "./format";
/** The caption of the selected place or home, with its journey and the way to step through it. */
export function Caption() {
  const store = useStore();
  const subject = useAtlas((state) => state.subject);
  const selected = subject.kind === "place" ? subject.id : null;
  const closeButton = useRef<HTMLButtonElement>(null);
  // A home is also a place under the same ID; the home caption speaks for both.
  const home = selected ? homeById.get(selected) : undefined;
  const place = home ? undefined : places.find((p) => p.id === selected);
  useEffect(() => {
    if (selected) closeButton.current?.focus({ preventScroll: true });
  }, [selected]);
  const select = (id: string) => store.dispatch({ type: "select", id });
  const dismiss = () => store.dispatch({ type: "deselect" });
  // Previous/next step through the journey when the place is part of one, else the chronology.
  const membership = place ? tripByPlace.get(place.id) : undefined;
  const itinerary = membership ? itineraries.get(membership.trip.id)! : undefined;
  const sequence = itinerary
    ? itinerary.map((entry) => entry.id)
    : chronology.map((candidate) => candidate.id);
  const sequenceIndex = place ? sequence.indexOf(place.id) : -1;
  const entry = itinerary?.[sequenceIndex];
  const step = (delta: number) => {
    const next = sequence[sequenceIndex + delta];
    if (next) select(next);
  };
  const placeVisits = place ? (visitsByPlace.get(place.id) ?? []) : [];
  // Where this place's day trips were made from, and where day trips from it went.
  const basesOf = [...new Set(placeVisits.flatMap((visit: PublicVisit) => (visit.from ? [visit.from] : [])))];
  const excursionsFrom = place ? dayTripPlaces(place.id) : home ? dayTripPlaces(home.id) : [];
  // The pairs of places this one was passed between, each once.
  const betweens = [
    ...new Map(
      placeVisits.flatMap((visit: PublicVisit) =>
        visit.between ? [[visit.between.join("|"), visit.between] as const] : [],
      ),
    ).values(),
  ];
  const placeLinks = (ids: string[]): ReactNode =>
    ids.map((id, index) => (
      <span key={id}>
        {index > 0 && (index === ids.length - 1 ? " and " : ", ")}
        <button type="button" className="caption-link" onClick={() => select(id)}>
          {baseLabel(id)}
        </button>
      </span>
    ));
  if (!place && !home) return null;
  return (
    <>
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
              countryName(place.country),
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
        {basesOf.length > 0 && (
          <p className="caption-daytrip">
            {placeVisits.filter((visit: PublicVisit) => visit.from).length === 1 ? "Day trip" : "Day trips"} from{" "}
            {placeLinks(basesOf)}
          </p>
        )}
        {excursionsFrom.length > 0 && (
          <p className="caption-daytrip">
            {excursionsFrom.length === 1 ? "Day trip" : "Day trips"} to {placeLinks(excursionsFrom)}
          </p>
        )}
        {betweens.map(([left, right]) => (
          <p key={`${left}|${right}`} className="caption-daytrip">
            On the way from {placeLinks([left])} to {placeLinks([right])}
          </p>
        ))}
        {membership && (() => {
          const trip = membership.trip;
          const from = trip.from ? homeById.get(trip.from) : undefined;
          const to = trip.to ? homeById.get(trip.to) : undefined;
          const perStop = stopNights.get(trip.id) ?? [];
          const total = perStop.reduce((a, b) => a + b, 0);
          const excursions = tripDayTrips(trip);
          const onTheWay = tripVia(trip);
          const summary = [
            roundTrip(trip),
            total ? plural(total, "night") : undefined,
            excursions ? plural(excursions, "day trip") : undefined,
            onTheWay ? `${onTheWay} on the way` : undefined,
          ]
            .filter(Boolean)
            .join(" · ");
          // Places passed on the way sit in the gap between two segments, as
          // the small marks they are on the map.
          const viaMarks = (hop: number) =>
            viaPlaces(trip, hop).map((id) => (
              <li key={`via-${hop}-${id}`} className="itinerary-via">
                <button type="button" tabIndex={-1}
                  title={`On the way, ${baseLabel(id)}`}
                  aria-label={`On the way, ${baseLabel(id)}`}
                  aria-current={entry?.id === id && entry.between ? "step" : undefined}
                  onClick={() => select(id)} />
              </li>
            ));
          return (
            <div className="itinerary">
              {summary && <p className="itinerary-summary">{summary}</p>}
              {/* Segment widths follow nights stayed: a schematic, never geography. */}
              <ol className="itinerary-strip" aria-label="Stops in this journey">
                {from && <li className="itinerary-home" aria-hidden="true" title={`Home, ${from.label}`} />}
                {viaMarks(0)}
                {trip.stops.map((stop, index) => {
                  const label = placeById.get(stop)?.label ?? stop;
                  const stay = perStop[index] ?? 0;
                  const detail = `${index + 1}. ${label}${stay ? `, ${plural(stay, "night")}` : ""}`;
                  const satellites = dayTripPlaces(stop, trip);
                  return (
                    <Fragment key={`${stop}-${index}`}>
                    <li style={{ flexGrow: Math.max(1, stay) }}>
                      {satellites.length > 0 && (
                        // Day trips sit above their stop as the hollow rings they are on the map.
                        <span className="itinerary-satellites">
                          {satellites.map((id) => (
                            <button key={id} type="button" tabIndex={-1}
                              title={`Day trip to ${baseLabel(id)}`}
                              aria-label={`Day trip to ${baseLabel(id)}`}
                              aria-current={entry?.id === id && entry.from === stop ? "step" : undefined}
                              onClick={() => select(id)} />
                          ))}
                        </span>
                      )}
                      <button type="button" tabIndex={-1} title={detail} aria-label={detail}
                        aria-current={entry?.stop === index + 1 ? "step" : undefined}
                        onClick={() => select(stop)} />
                    </li>
                    {viaMarks(index + 1)}
                    </Fragment>
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
            {membership && entry?.stop
              ? <>Part of <em>{membership.trip.label}</em> · stop {entry.stop} of {membership.trip.stops.length}</>
              : membership && entry?.from
                ? <>Part of <em>{membership.trip.label}</em> · day trip from {baseLabel(entry.from)}</>
                : membership && entry?.between
                  ? <>Part of <em>{membership.trip.label}</em> · on the way from {baseLabel(entry.between[0])} to {baseLabel(entry.between[1])}</>
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
        <p id="place-geography">{countryName(home.country)}</p>
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
        {excursionsFrom.length > 0 && (
          <p className="caption-daytrip">
            {excursionsFrom.length === 1 ? "Day trip" : "Day trips"} to {placeLinks(excursionsFrom)}
          </p>
        )}
      </section>
    )}
    </>
  );
}
