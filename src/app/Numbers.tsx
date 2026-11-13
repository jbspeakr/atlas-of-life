import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { homes } from "../map/data";
import type { Milestone, YearRow } from "../../scripts/stats";
import { useAtlas, useStore } from "../state/store";
import { homeById, placeById, stats, tripById } from "./derived";
import { count, countryName, degrees, formatMonth, numberFormatter, percent } from "./format";
const earthCircumferenceKm = 40_075;
/** "By the numbers": totals, coverage, milestones and years. Stays mounted so the compared years survive closing. */
export function Numbers({ opener }: { opener: RefObject<HTMLButtonElement | null> }) {
  const store = useStore();
  const open = useAtlas((state) => state.panel === "numbers");
  const closeButton = useRef<HTMLButtonElement>(null);
  // The two years side by side: the latest two until the viewer picks others.
  const [compare, setCompare] = useState<[number, number]>(() => {
    const listed = stats.years.map((row) => row.year);
    return [listed[listed.length - 2] ?? listed[0] ?? 0, listed[listed.length - 1] ?? 0];
  });
  useEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  const close = () => {
    store.dispatch({ type: "closePanel", panel: "numbers" });
    opener.current?.focus({ preventScroll: true });
  };
  // A milestone names a place as a link that lights it; selecting closes the panel.
  const placeLink = (id: string): ReactNode => {
    const target = placeById.get(id);
    if (!target) return id;
    return (
      <a
        href={`#/place/${encodeURIComponent(id)}`}
        onClick={(event) => {
          event.preventDefault();
          store.dispatch({ type: "select", id });
        }}
      >
        {target.label}
      </a>
    );
  };
  const tripLink = (id: string): ReactNode => {
    const trip = tripById.get(id);
    if (!trip) return id;
    return (
      <button
        type="button"
        className="stats-link"
        onClick={() => {
          close();
          store.dispatch({ type: "focusJourney", id });
        }}
      >
        {trip.label}
      </button>
    );
  };
  const milestone = (entry: Milestone): ReactNode => {
    switch (entry.kind) {
      case "first":
        return <>It began in {placeLink(entry.place)}, {formatMonth(entry.date)}.</>;
      case "distance": {
        const around = entry.km / earthCircumferenceKm;
        const scale =
          around >= 1
            ? `, ${around.toFixed(1)} times around the world`
            : around >= 0.05
              ? `, ${Math.round(around * 100)} % of the way around the world`
              : "";
        return <>At least {numberFormatter.format(entry.km)} km as the crow flies{scale}.</>;
      }
      case "furthest":
        return (
          <>
            Furthest from home: {placeLink(entry.place)}, {numberFormatter.format(entry.km)} km from{" "}
            {homeById.get(entry.home)?.label ?? "home"}.
          </>
        );
      case "journey":
        return (
          <>
            Longest journey: {tripLink(entry.trip)}, {count(entry.nights, "night")},{" "}
            {count(entry.stops, "stop")}
            {entry.dayTrips ? ` and ${count(entry.dayTrips, "day trip")}` : ""} in{" "}
            {count(entry.countries, "country", "countries")}.
          </>
        );
      case "daytrips":
        return <>Most day trips from one place: {placeLink(entry.place)}, {entry.dayTrips}.</>;
      case "north":
      case "south":
      case "east":
      case "west": {
        const vertical = entry.kind === "north" || entry.kind === "south";
        const point = placeById.get(entry.place)?.coordinates ?? [0, 0];
        const label = { north: "Northernmost", south: "Southernmost", east: "Easternmost", west: "Westernmost" }[entry.kind];
        return (
          <>
            {label}: {placeLink(entry.place)}, {degrees(point[vertical ? 1 : 0], vertical ? "lat" : "lng")}.
          </>
        );
      }
      case "arctic":
      case "antarctic":
      case "equator": {
        const line = {
          arctic: "North of the Arctic Circle",
          antarctic: "South of the Antarctic Circle",
          equator: "South of the equator",
        }[entry.kind];
        return (
          <>
            {line}
            {entry.date ? " for the first time" : ""}: {placeLink(entry.place)}
            {entry.date ? `, ${formatMonth(entry.date)}` : ""}.
          </>
        );
      }
      case "nights":
        return <>Most nights in one country: {countryName(entry.country)}, {numberFormatter.format(entry.nights)}.</>;
      case "returns":
        return <>Most returned to: {placeLink(entry.place)}, {count(entry.visits, "visit")}.</>;
      case "gap":
        return (
          <>
            Longest time between trips: {count(entry.days, "day")}, {placeLink(entry.from)} to{" "}
            {placeLink(entry.to)}.
          </>
        );
    }
  };
  const compared = compare.map(
    (year) => stats.years.find((row) => row.year === year) ?? stats.years[0],
  ) as [YearRow | undefined, YearRow | undefined];
  const comparison: [string, (row: YearRow) => ReactNode][] = [
    ["Visits", (row) => row.visits],
    ...(stats.years.some((row) => row.dayTrips)
      ? [["Day trips", (row: YearRow) => row.dayTrips] as [string, (row: YearRow) => ReactNode]]
      : []),
    ["Nights away", (row) => row.nights],
    ["Countries", (row) => row.countries],
    ["New countries", (row) => row.newCountries],
    ["New places", (row) => row.newPlaces],
    ...(stats.years.some((row) => row.furthest)
      ? [
          [
            "Furthest from home",
            (row: YearRow) =>
              row.furthest ? (
                <>
                  {placeLink(row.furthest.place)}
                  <small>{numberFormatter.format(row.furthest.km)} km</small>
                </>
              ) : (
                "—"
              ),
          ] as [string, (row: YearRow) => ReactNode],
        ]
      : []),
    [
      "Longest stay",
      (row) =>
        row.longestStay ? (
          <>
            {placeLink(row.longestStay.place)}
            <small>{count(row.longestStay.nights, "night")}</small>
          </>
        ) : (
          "—"
        ),
    ],
  ];
  return (
    <section className="atlas-stats" id="atlas-stats" aria-label="By the numbers">
      <div className="explorer-heading">
        <h2>By the numbers</h2>
        <button ref={closeButton} type="button" className="icon-button" aria-label="Close numbers"
          onClick={close}>×</button>
      </div>
      <dl className="stats-totals">
        <div><dt>Countries</dt><dd>{stats.countries}</dd></div>
        <div><dt>Regions</dt><dd>{stats.regions}</dd></div>
        <div><dt>Places</dt><dd>{stats.places}</dd></div>
        <div>
          <dt>Visits</dt>
          <dd>
            {stats.visits}
            {stats.dayTrips > 0 && <small>{count(stats.dayTrips, "day trip")}</small>}
            {stats.via > 0 && <small>{numberFormatter.format(stats.via)} on the way</small>}
          </dd>
        </div>
        <div><dt>Journeys</dt><dd>{stats.journeys}</dd></div>
        <div><dt>Nights away</dt><dd>{stats.nights}</dd></div>
      </dl>
      <div className="stats-coverage">
        <p>
          <span className="stats-bar" aria-hidden="true">
            <i style={{ width: `${(stats.coverage.states / stats.coverage.of) * 100}%` }} />
          </span>
          <strong>{stats.coverage.states}</strong> of {stats.coverage.of} countries ·{" "}
          {percent(stats.coverage.states, stats.coverage.of)} of the world
          {stats.coverage.territories
            ? `, and ${count(stats.coverage.territories, "territory", "territories")}`
            : ""}
        </p>
        {stats.coverage.continents.length > 0 && (
          <table className="stats-continents">
            <caption>
              {stats.coverage.continents.length} of {stats.coverage.continentsOf} continents
            </caption>
            <tbody>
              {stats.coverage.continents.map((row) => (
                <tr key={row.continent}>
                  <th scope="row">{row.continent}</th>
                  <td>
                    {row.of > 0 && (
                      <span className="stats-bar" aria-hidden="true">
                        <i style={{ width: `${(row.visited / row.of) * 100}%` }} />
                      </span>
                    )}
                    {row.of > 0 ? `${row.visited} of ${row.of}` : row.visited}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {homes.map((entry) => (
        <p className="stats-note" key={entry.id}>
          Home <em>{entry.label}</em>
          {entry.since ? `, since ${formatMonth(entry.since)}` : ""}
          {entry.until ? ` until ${formatMonth(entry.until)}` : ""}
        </p>
      ))}
      {stats.longestStay && (
        <p className="stats-note">
          Longest stay {placeLink(stats.longestStay.place)}, {count(stats.longestStay.nights, "night")}
        </p>
      )}
      {stats.milestones.length > 0 && (
        <>
          <h3 className="stats-heading">Milestones</h3>
          <ul className="stats-milestones">
            {stats.milestones.map((entry) => (
              <li key={entry.kind}>{milestone(entry)}</li>
            ))}
          </ul>
        </>
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
      {stats.years.length > 1 && compared[0] && compared[1] && (
        <table className="stats-compare">
          <caption>Years compared</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Figure</span></th>
              {(["First year", "Second year"] as const).map((name, index) => (
                <th scope="col" key={name}>
                  <select
                    aria-label={name}
                    value={compared[index]!.year}
                    onChange={(event) => {
                      const next: [number, number] = [compare[0], compare[1]];
                      next[index] = Number(event.target.value);
                      setCompare(next);
                    }}
                  >
                    {stats.years.map((row) => (
                      <option key={row.year} value={row.year}>{row.year}</option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.map(([label, cell]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{cell(compared[0]!)}</td>
                <td>{cell(compared[1]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="stats-countries">
        <caption>Places by country</caption>
        <thead>
          <tr>
            <th scope="col">Country</th>
            <th scope="col">Places</th>
            <th scope="col">Regions</th>
            <th scope="col">First</th>
          </tr>
        </thead>
        <tbody>
          {stats.byCountry.map((row) => (
            <tr key={row.country}>
              <th scope="row">{countryName(row.country)}</th>
              <td>{row.places}</td>
              <td>{row.regionsOf ? `${row.regions} of ${row.regionsOf}` : row.regions || "—"}</td>
              <td>{row.firstYear ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
