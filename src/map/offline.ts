/** Opt-in offline copy of the bundled basemap archive, served back by the service worker. */
const ARCHIVE = "atlas-archive";
export const offlineSupported = () =>
  "serviceWorker" in navigator && "caches" in window;
export async function archiveSaved(url: string): Promise<number | null> {
  if (!offlineSupported()) return null;
  const cache = await caches.open(ARCHIVE);
  const response = await cache.match(url);
  if (!response) return null;
  return Number(response.headers.get("Content-Length")) || (await response.blob()).size;
}
export async function saveArchive(
  url: string,
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok || !response.body) throw new Error(`Archive ${url}: HTTP ${response.status}`);
  const total = Number(response.headers.get("Content-Length")) || 0;
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && total && total > estimate.quota - (estimate.usage ?? 0))
    throw new Error("Not enough storage for the map archive");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received, total);
  }
  const blob = new Blob(chunks as BlobPart[], { type: "application/vnd.pmtiles" });
  const cache = await caches.open(ARCHIVE);
  await cache.put(
    url,
    new Response(blob, {
      headers: { "Content-Type": "application/vnd.pmtiles", "Content-Length": String(blob.size), "Accept-Ranges": "bytes" },
    }),
  );
  return blob.size;
}
export async function removeArchive(url: string): Promise<void> {
  const cache = await caches.open(ARCHIVE);
  await cache.delete(url);
}
export function registerServiceWorker(base: string): void {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  const url = new URL("sw.js", new URL(base, location.href)).href;
  navigator.serviceWorker.register(url, { scope: new URL(base, location.href).pathname }).catch(() => {
    /* Offline support is an enhancement; the atlas works without it. */
  });
}
