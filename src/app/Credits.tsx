import { useEffect, useRef, useState } from "react";
import type { Atlas } from "../map/create-map";
import { archiveSaved, offlineSupported, removeArchive, saveArchive } from "../map/offline";
import { deterministic, megabytes } from "./format";
type Offline =
  | { state: "unavailable" }
  | { state: "absent" }
  | { state: "saving"; received: number; total: number }
  | { state: "saved"; bytes: number }
  | { state: "error"; message: string };
/** Map credits, and saving the bundled basemap for offline use. */
export function Credits({ atlas }: { atlas: Atlas | null }) {
  const [offline, setOffline] = useState<Offline>({ state: "unavailable" });
  const offlineAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!atlas?.archive.bundled || !offlineSupported() || deterministic) return;
    let live = true;
    void archiveSaved(atlas.archive.url).then((bytes) => {
      if (live) setOffline(bytes === null ? { state: "absent" } : { state: "saved", bytes });
    });
    return () => {
      live = false;
    };
  }, [atlas]);
  return (
    <details className="attribution">
      <summary>© OpenStreetMap contributors · Map credits</summary>
      <div>
        {offline.state !== "unavailable" && (
          <p className="offline" role="status">
            {offline.state === "absent" && (
              <button type="button" onClick={() => {
                const url = atlas?.archive.url;
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
                  const url = atlas?.archive.url;
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
  );
}
