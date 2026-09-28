/**
 * Emits dist/sw.js: precache of the app shell, cache-first for hashed assets,
 * navigation fallback to the cached page, and 206 answers for a saved archive.
 * The worker source is a template string so the build stays dependency-free.
 */
export function serviceWorkerSource(precache: string[], version: string): string {
  return `/* Atlas of a Life service worker ${version} */
const VERSION = ${JSON.stringify(version)};
const SHELL = "atlas-shell-" + VERSION;
const ARCHIVE = "atlas-archive";
const PRECACHE = ${JSON.stringify(precache)};
const scopeUrl = new URL(self.registration.scope);
const shellUrl = (path) => new URL(path, scopeUrl).href;
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.map(shellUrl))).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("atlas-shell-") && key !== SHELL).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});
async function rangeFromArchive(request) {
  const cache = await caches.open(ARCHIVE);
  const full = await cache.match(request.url, { ignoreSearch: false, ignoreVary: true });
  if (!full) return undefined;
  const blob = await full.blob();
  const range = request.headers.get("range");
  if (!range) return new Response(blob, { headers: { "Content-Type": "application/vnd.pmtiles", "Accept-Ranges": "bytes" } });
  const match = /bytes=(\\d*)-(\\d*)/.exec(range);
  if (!match) return new Response(null, { status: 416 });
  const size = blob.size;
  let start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  let end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": "application/vnd.pmtiles",
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.endsWith(".pmtiles")) {
    event.respondWith(rangeFromArchive(request).then((response) => response ?? fetch(request)));
    return;
  }
  if (url.origin !== scopeUrl.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(shellUrl("./")).then((cached) => cached ?? Response.error())));
    return;
  }
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? fetch(request)),
  );
});
`;
}
