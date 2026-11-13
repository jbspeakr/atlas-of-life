import type { TimeMode } from "../map/time";
import { useAtlas, useStore } from "../state/store";
import { positions } from "./derived";
import { formatMonth } from "./format";
export const timeLabel = (through: string | null, mode: TimeMode) =>
  through === null
    ? "All visits"
    : `${mode === "only" ? "During" : "Through"} ${formatMonth(through)}`;
/** The scrubber and its Through/During mode. */
export function Timeline() {
  const store = useStore();
  const { through, mode } = useAtlas((state) => state.timeline);
  const applyFilter = (nextThrough: string | null, nextMode: TimeMode) =>
    store.dispatch({ type: "filter", through: nextThrough, mode: nextMode });
  const position = through === null ? positions.length : positions.indexOf(through);
  return (
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
          aria-valuetext={timeLabel(through, mode)}
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
  );
}
