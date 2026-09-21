import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { PNG } from "pngjs";
import { bytesToHeader, PMTiles, type Header } from "pmtiles";

interface Hop {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  status: number;
  headers: Record<string, string>;
  elapsedMs: number;
}
interface Exchange {
  hops: Hop[];
  error?: string;
  bytes: number;
  body?: Buffer;
}
interface Expectations {
  minZoom?: number;
  maxZoom?: number;
  bounds?: [number, number, number, number];
}
interface BrowserResult {
  status: "pass" | "fail";
  origin: string;
  renderedFeatures: number;
  changedPixels: number;
  consoleErrors: string[];
  requests: { url: string; status: number; range: string | null }[];
  error?: string;
}
interface Probe {
  url: string;
  origin: string;
  measuredAt: string;
  expectations: Expectations;
  status: "pass" | "fail";
  head: Exchange;
  range: Exchange;
  preflight: Exchange;
  header?: Header;
  layerNames: string[];
  checks: Record<string, boolean>;
  browser: BrowserResult;
}
interface Report {
  probes: Probe[];
  prerequisites: string[];
  discovery?: unknown;
}
const output = "verification/hosting-results.json";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Signed redirect query strings are transient access grants; retain keys, never credentials.
function safeUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()])
    if (/token|signature|policy|credential|key-pair|authorization/i.test(key))
      url.searchParams.set(key, "[redacted]");
  url.username = "";
  url.password = "";
  return url.href;
}
async function exchange(
  url: string,
  method: string,
  headers: Record<string, string>,
  limit = 0,
): Promise<Exchange> {
  const result: Exchange = { hops: [], bytes: 0 };
  try {
    for (let redirect = 0; redirect <= 10; redirect++) {
      const started = performance.now();
      const response = await fetch(url, {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const recordedHeaders: Record<string, string> = {};
      for (const [key, value] of response.headers) {
        if (key === "set-cookie") continue;
        recordedHeaders[key] =
          key === "location" ? safeUrl(new URL(value, url).href) : value;
      }
      result.hops.push({
        url: safeUrl(url),
        method,
        requestHeaders: headers,
        status: response.status,
        headers: recordedHeaders,
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      });
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.has("location")
      ) {
        const next = new URL(response.headers.get("location")!, url);
        if (!["http:", "https:"].includes(next.protocol))
          throw new Error("Redirect used a non-HTTP protocol");
        await response.body?.cancel();
        url = next.href; // Preserve the original method and Range on every hop.
        continue;
      }
      if (limit && response.body) {
        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let length = 0;
        while (length < limit) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const part = Buffer.from(chunk.value.subarray(0, limit - length));
          chunks.push(part);
          length += part.length;
        }
        await reader.cancel();
        result.body = Buffer.concat(chunks);
        result.bytes = length;
      } else await response.body?.cancel();
      return result;
    }
    throw new Error("Exceeded 10 manual redirects");
  } catch (error) {
    result.error = errorText(error);
    return result;
  }
}

async function browserProbe(
  url: string,
  origin: string,
  header?: Header,
): Promise<BrowserResult> {
  const result: BrowserResult = {
    status: "fail",
    origin,
    renderedFeatures: 0,
    changedPixels: 0,
    consoleErrors: [],
    requests: [],
  };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
    });
    page.on("console", (message) => {
      if (message.type() === "error") result.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => result.consoleErrors.push(error.message));
    page.on("response", (response) => {
      if (response.request().resourceType() === "fetch")
        result.requests.push({
          url: safeUrl(response.url()),
          status: response.status(),
          range: response.request().headers().range ?? null,
        });
    });
    const documentUrl = `${origin}/__atlas_hosting_probe__`;
    await page.route(documentUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><link rel="icon" href="data:,"><title>Archive hosting probe</title></head><body style="margin:0"><div id="map" style="width:800px;height:600px"></div></body></html>',
      }),
    );
    await page.goto(documentUrl);
    await page.addStyleTag({
      path: "node_modules/maplibre-gl/dist/maplibre-gl.css",
    });
    await page.addScriptTag({
      path: "node_modules/maplibre-gl/dist/maplibre-gl.js",
    });
    await page.addScriptTag({ path: "node_modules/pmtiles/dist/pmtiles.js" });
    // The document is fulfilled locally at the requested origin; archive fetches are NEVER intercepted.
    const value = (await page.evaluate(`(async () => {
      const archiveUrl = ${JSON.stringify(url)};
      const protocol = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', protocol.tile);
      const archive = new pmtiles.PMTiles(archiveUrl); protocol.add(archive);
      const { promise: timeout, reject: rejectTimeout } = Promise.withResolvers();
      setTimeout(() => rejectTimeout(new Error('Browser tile render exceeded 30s')), 30000);
      return Promise.race([timeout, (async () => {
        const h = await archive.getHeader(); const metadata = await archive.getMetadata();
        const raster = h.tileType !== 1;
        const layers = [{ id: 'background', type: 'background', paint: { 'background-color': '#080f18' } }];
        if (raster) layers.push({ id: 'raster', type: 'raster', source: 'archive' });
        else for (const layer of metadata.vector_layers || []) {
          layers.push({ id: layer.id + '-fill', type: 'fill', source: 'archive', 'source-layer': layer.id, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#efc784', 'fill-opacity': 0.7 } });
          layers.push({ id: layer.id + '-line', type: 'line', source: 'archive', 'source-layer': layer.id, filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#f1eee7', 'line-width': 2 } });
          layers.push({ id: layer.id + '-point', type: 'circle', source: 'archive', 'source-layer': layer.id, filter: ['==', '$type', 'Point'], paint: { 'circle-color': '#efc784', 'circle-radius': 4 } });
        }
        if (layers.length === 1) throw new Error('No vector_layers metadata: cannot construct an evidence-based render');
        const map = new maplibregl.Map({ container: 'map', interactive: false, attributionControl: false, canvasContextAttributes: { preserveDrawingBuffer: true }, center: [h.centerLon, h.centerLat], zoom: Math.max(h.minZoom, Math.min(h.maxZoom, h.centerZoom)), style: { version: 8, sources: { archive: { type: raster ? 'raster' : 'vector', url: 'pmtiles://' + archiveUrl } }, layers } });
        window.__hostingMap = map;
        const errors = []; map.on('error', event => errors.push(event.error.message));
        const { promise: idle, resolve: onIdle } = Promise.withResolvers();
        map.once('idle', onIdle); await idle;
        if (errors.length) throw new Error(errors.join('; '));
        return { features: raster ? 0 : map.queryRenderedFeatures().length, raster };
      })()]);
    })()`)) as { features: number; raster: boolean };
    result.renderedFeatures = value.features;
    const png = PNG.sync.read(await page.locator("canvas").screenshot());
    for (let i = 0; i < png.data.length; i += 4)
      if (
        Math.abs(png.data[i]! - 8) +
          Math.abs(png.data[i + 1]! - 15) +
          Math.abs(png.data[i + 2]! - 24) >
        24
      )
        result.changedPixels++;
    result.status =
      result.changedPixels > 100 &&
      (value.raster || value.features > 0) &&
      result.consoleErrors.length === 0 &&
      Boolean(header)
        ? "pass"
        : "fail";
  } catch (error) {
    result.error = errorText(error);
  } finally {
    await browser?.close();
  }
  return result;
}

export async function probeHosting(
  url: string,
  origin: string,
  expectations: Expectations = {},
): Promise<Probe> {
  expectations = {
    minZoom: expectations.minZoom ?? 0,
    maxZoom: expectations.maxZoom ?? 14,
    bounds: expectations.bounds ?? [-180, -85.0511287, 180, 85.0511287],
  };
  const common = { Origin: origin, "Accept-Encoding": "identity" };
  const [head, range, preflight] = await Promise.all([
    exchange(url, "HEAD", common),
    exchange(url, "GET", { ...common, Range: "bytes=0-16383" }, 16384),
    exchange(url, "OPTIONS", {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "range",
    }),
  ]);
  const rangeHop = range.hops.at(-1);
  const headHop = head.hops.at(-1);
  const preflightHop = preflight.hops.at(-1);
  const crossOrigin = new URL(url).origin !== origin;
  const exposedHeaders = (
    rangeHop?.headers["access-control-expose-headers"] ?? ""
  )
    .toLowerCase()
    .split(/\s*,\s*/);
  const checks: Record<string, boolean> = {
    head:
      !head.error &&
      headHop?.status === 200 &&
      Number(headHop.headers["content-length"]) >= 16384,
    range:
      !range.error &&
      rangeHop?.status === 206 &&
      /^bytes 0-16383\/\d+$/.test(rangeHop.headers["content-range"] ?? "") &&
      range.bytes === 16384,
    acceptRanges: headHop?.headers["accept-ranges"]?.toLowerCase() === "bytes",
    cors:
      !crossOrigin ||
      Boolean(
        rangeHop &&
        ["*", origin].includes(
          rangeHop.headers["access-control-allow-origin"] ?? "",
        ),
      ),
    exposedRange:
      !crossOrigin ||
      exposedHeaders.includes("content-range") ||
      exposedHeaders.includes("*"),
    exposedEtag:
      !crossOrigin ||
      exposedHeaders.includes("etag") ||
      exposedHeaders.includes("*"),
    preflight:
      !crossOrigin ||
      Boolean(
        !preflight.error &&
        preflightHop &&
        preflightHop.status >= 200 &&
        preflightHop.status < 300 &&
        ["*", origin].includes(
          preflightHop.headers["access-control-allow-origin"] ?? "",
        ) &&
        /(?:^|[,\s])(?:get|\*)(?:$|[,\s])/i.test(
          preflightHop.headers["access-control-allow-methods"] ?? "",
        ) &&
        /(?:^|[,\s])(?:range|\*)(?:$|[,\s])/i.test(
          preflightHop.headers["access-control-allow-headers"] ?? "",
        ),
      ),
  };
  let header: Header | undefined;
  let layerNames: string[] = [];
  try {
    if (
      range.body?.subarray(0, 7).toString() !== "PMTiles" ||
      range.body[7] !== 3
    )
      throw new Error("Expected PMTiles v3 magic and 127-byte header");
    header = bytesToHeader(Uint8Array.from(range.body).buffer);
    checks.header = true;
    checks.zoom =
      (expectations.minZoom === undefined ||
        header.minZoom <= expectations.minZoom) &&
      (expectations.maxZoom === undefined ||
        header.maxZoom >= expectations.maxZoom);
    const bounds = expectations.bounds;
    checks.bounds =
      !bounds ||
      (header.minLon <= bounds[0] &&
        header.minLat <= bounds[1] &&
        header.maxLon >= bounds[2] &&
        header.maxLat >= bounds[3]);
    checks.vector = header.tileType === 1;
    try {
      const metadata = (await new PMTiles(url).getMetadata()) as {
        vector_layers?: { id: string }[];
      };
      layerNames = Array.isArray(metadata.vector_layers)
        ? metadata.vector_layers.map((layer) => layer.id)
        : [];
      checks.styleLayers = ["earth", "water", "roads"].every((name) =>
        layerNames.includes(name),
      );
    } catch (error) {
      checks.styleLayers = false;
      range.error = `Protomaps metadata: ${errorText(error)}`;
    }
  } catch (error) {
    checks.header = false;
    range.error = [range.error, errorText(error)].filter(Boolean).join("; ");
  }
  delete range.body;
  const browser = await browserProbe(url, origin, header);
  checks.browser = browser.status === "pass";
  return {
    url: safeUrl(url),
    origin,
    measuredAt: new Date().toISOString(),
    expectations,
    layerNames,
    status: Object.values(checks).every(Boolean) ? "pass" : "fail",
    head,
    range,
    preflight,
    header,
    checks,
    browser,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: npm run verify:hosting -- URL --origin https://site.example [--min-zoom 0] [--max-zoom 14] [--bounds west,south,east,north]\nAppends measured HEAD/Range/CORS/preflight, PMTiles header and Chromium render evidence to verification/hosting-results.json. Requires installed Playwright Chromium (npx playwright install chromium).",
    );
    return;
  }
  const url = args.shift();
  if (!url || !/^https?:\/\//.test(url))
    throw new Error(
      "A real public HTTP(S) PMTiles URL is required; use --help. No candidate resource is invented.",
    );
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.search)
    throw new Error(
      "Use a public credential-free URL without query parameters; signed redirect parameters are handled internally.",
    );
  const options = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!;
    const value = args.shift();
    if (
      !["--origin", "--min-zoom", "--max-zoom", "--bounds"].includes(key) ||
      !value ||
      options.has(key)
    )
      throw new Error(`Invalid or duplicate option: ${key}`);
    options.set(key, value);
  }
  const originOption = options.get("--origin");
  if (!originOption)
    throw new Error(
      "--origin is required so CORS is measured against the actual deployment origin.",
    );
  const origin = new URL(originOption).origin;
  if (
    !/^https?:\/\//.test(origin) ||
    originOption.replace(/\/$/, "") !== origin
  )
    throw new Error(
      "--origin must contain only an HTTP(S) scheme and host, not a path.",
    );
  const expectations: Expectations = {};
  for (const [key, field] of [
    ["--min-zoom", "minZoom"],
    ["--max-zoom", "maxZoom"],
  ] as const)
    if (options.has(key)) {
      const value = Number(options.get(key));
      if (!Number.isInteger(value) || value < 0 || value > 30)
        throw new Error(`${key} must be an integer from 0 to 30`);
      expectations[field] = value;
    }
  if (
    expectations.minZoom !== undefined &&
    expectations.maxZoom !== undefined &&
    expectations.minZoom > expectations.maxZoom
  )
    throw new Error("Expected minimum zoom exceeds maximum zoom");
  if (options.has("--bounds")) {
    const values = options.get("--bounds")!.split(",").map(Number);
    if (
      values.length !== 4 ||
      values.some((value) => !Number.isFinite(value)) ||
      values[0]! < -180 ||
      values[2]! > 180 ||
      values[1]! < -90 ||
      values[3]! > 90 ||
      values[0]! > values[2]! ||
      values[1]! > values[3]!
    )
      throw new Error("--bounds must be west,south,east,north in degrees");
    expectations.bounds = values as [number, number, number, number];
  }
  let report: Report = {
    probes: [],
    prerequisites: [
      "Publishing requires an authenticated hf CLI session with write access to an owner-supplied public dataset.",
      "Owner HF Storage and R2 public archive URLs and write credentials were not supplied; a public sample does not verify an owner deployment.",
    ],
  };
  try {
    report = JSON.parse(await readFile(output, "utf8")) as Report;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const probe = await probeHosting(parsed.href, origin, expectations);
  report.probes.push(probe);
  await mkdir("verification", { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${probe.status.toUpperCase()} ${probe.url}: ${Object.entries(probe.checks)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}; evidence: ${output}`,
  );
  if (probe.status !== "pass") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`Hosting probe: ${errorText(error)}`);
    process.exitCode = 1;
  });
