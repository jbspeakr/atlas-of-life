import { FetchSource } from "pmtiles";
/**
 * WebKit's HTTP cache (every browser on iOS, Safari elsewhere) answers a
 * ranged request to the archive from an earlier response once it holds one,
 * which PMTiles rejects as a full 200. Private windows, which keep no cache,
 * are unaffected, and so are Blink and Gecko. Chrome on Android carries a
 * Chrome token, so only true WebKit matches.
 */
export const bypassesHttpCache = (userAgent: string): boolean =>
  /AppleWebKit\//.test(userAgent) && !/\b(?:Chrome|Chromium|Edg)\//.test(userAgent);
/** The archive source, read past the browser cache where that cache is unsafe. */
export function archiveSource(url: string): FetchSource {
  const source = new FetchSource(url);
  // PMTiles' own switch for the same failure in Chrome on Windows: every
  // ranged request is then sent with `cache: "no-store"`.
  if (bypassesHttpCache(navigator.userAgent)) source.chromeWindowsNoCache = true;
  return source;
}
