import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "@playwright/test";
import { PNG } from "pngjs";
import type { Place } from "../src/map/create-map.ts";
import { camera, ready, settle, type AtlasWindow } from "../verification/browser.ts";
import { startServer, type VerificationServer } from "../verification/server.ts";
import type { CameraState, TourPlace } from "./recording.ts";
import { cameraAtFrame, createGlobeTour, encodeVideo, selectTourStops } from "./recording.ts";

const presets = {
  portrait: { width: 540, height: 960 },
  square: { width: 540, height: 540 },
  landscape: { width: 960, height: 540 },
};
type Format = keyof typeof presets;
const help = `Record a cinematic 24-second globe and region flight (30 fps, silent).

Usage: npm run record -- [--format all|portrait|square|landscape]
                        [--place <public-id-or-label>] [--out <new-directory>]

Defaults: all formats; first freshly built public place anchors a geographically
varied route of up to four entries; unique UTC-stamped recordings/<timestamp>-<random>
directory. --place changes that anchor, not a city close-up. Exact public IDs take
precedence over case-insensitive exact labels; ambiguous/missing places are errors.

Outputs: portrait.mp4 (1080x1920), square.mp4 (1080x1080), landscape.mp4
(1920x1080), each with a full-resolution <format>-poster.png.
Two regional reveals use fixed-center zooms, short holds and a broad transfer
between areas. Minimum-jerk easing keeps pans and zooms smooth; the ending pulls
back calmly instead of forcing a reverse sweep to the opening angle.
Published city pins and fixed-anchor labels remain visible during capture.
Regional zoom reaches 4.75–5; production styles are unchanged.
Real navigation, all-years timeline, typography and attribution remain visible.
There are no city close-ups, place dialogs, added editorial captions or audio.
An explicit output directory must not already exist, even if empty.

Requires Node 22.12+, installed npm dependencies and Playwright Chromium:
  npm ci
  npx playwright install chromium
Install FFmpeg including ffprobe and the libx264 encoder (macOS: brew install ffmpeg).

Runs the ordinary build once with VITE_BASE=/atlas/, using current public data
and your existing basemap/privacy configuration. Never run alongside another
build or verification. Offline lossless capture takes longer than playback.
Port 4180 must be free. Ctrl-C stops owned processes, removes unfinished media,
and preserves completed formats. Music, editorial captions and publishing are separate.
`;

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// A separate process group lets cancellation stop npm's build descendants too.
async function command(binary: string, args: string[], signal: AbortSignal, build = false) {
  signal.throwIfAborted();
  const child = spawn(binary, args, {
    env: build ? { ...process.env, VITE_BASE: "/atlas/" } : process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data: Buffer) => {
    stdout = (stdout + data.toString()).slice(-65536);
    if (build) process.stdout.write(data);
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-8192);
    if (build) process.stderr.write(data);
  });
  const stop = (killSignal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, killSignal);
      else child.kill(killSignal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  const abort = () => {
    stop("SIGTERM");
    timer = setTimeout(() => stop("SIGKILL"), 2000);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, killed) => code === 0 ? accept() : reject(
        new Error(`${binary} failed (${killed ?? code}): ${stderr}`),
      ));
    });
    signal.throwIfAborted();
    return stdout;
  } finally {
    signal.removeEventListener("abort", abort);
    if (timer) clearTimeout(timer);
  }
}

async function loadTour(query?: string): Promise<TourPlace[]> {
  const data: unknown = JSON.parse(await readFile("src/generated/places.json", "utf8"));
  if (!Array.isArray(data) || data.length === 0 || data.some((p) =>
    !p || typeof p.id !== "string" || !p.id || typeof p.label !== "string" || !p.label))
    throw new Error("Generated public places must be a nonempty list with IDs and labels.");
  const places = data as Place[];
  const id = query === undefined ? undefined : places.find((p) => p.id === query);
  const matches = query === undefined ? [places[0]] : id ? [id] :
    places.filter((p) => p.label.toLocaleLowerCase("en-GB") === query.toLocaleLowerCase("en-GB"));
  if (matches.length !== 1) {
    const candidates = matches.length ? matches : places;
    throw new Error(`${matches.length ? "Ambiguous" : "Missing"} public place ${JSON.stringify(query)}. Candidates:\n` +
      candidates.map((p) => `  ${p.label}: ${p.id}`).join("\n"));
  }
  for (const place of places) {
    if (!Array.isArray(place.coordinates) || place.coordinates.length !== 2 ||
        !place.coordinates.every(Number.isFinite) || Math.abs(place.coordinates[0]) > 180 ||
        Math.abs(place.coordinates[1]) > 85.051129)
      throw new Error(`Invalid published map coordinates for ${place.label} (${place.id}).`);
  }
  return selectTourStops(places, matches[0]);
}


async function recordFormat(browser: Browser, origin: string, format: Format, stops: readonly TourPlace[],
  directory: string, signal: AbortSignal, completed: string[]) {
  const viewport = presets[format];
  const size = { width: viewport.width * 2, height: viewport.height * 2 };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "en-GB",
    timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    // Match the compiler helper used by verification/browser.ts without its instrumentation.
    await context.addInitScript('globalThis.__name = (target, value) => Object.defineProperty(target, "name", {value, configurable:true});');
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    const fail = (message: string) => { if (errors.length < 20) errors.push(message); };
    page.on("pageerror", (error) => fail(error.message));
    page.on("console", (message) => { if (message.type() === "error") fail(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) fail(`HTTP ${response.status()}: ${response.url()}`); });
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") fail(`${request.url()}: ${request.failure()?.errorText}`);
    });
    await page.exposeFunction("recordMapError", (message: string) => fail(`Map error: ${message}`));
    const health = async () => {
      signal.throwIfAborted();
      if (errors.length) throw new Error(`Capture failed:\n${errors.join("\n")}`);
      const alert = page.getByRole("alert");
      if (await alert.isVisible()) throw new Error(`Application error: ${await alert.innerText()}`);
    };
    const response = await page.goto(`${origin}/atlas/?deterministic=1`);
    if (response?.status() !== 200) throw new Error(`Navigation failed: HTTP ${response?.status()}`);
    try { await ready(page); } catch (error) { await health(); throw error; }
    await page.evaluate(() => {
      (window as unknown as AtlasWindow).__atlas.map.on("error", (event) => {
        void (window as unknown as { recordMapError(message: string): Promise<void> }).recordMapError(event.error.message);
      });
    });
    await health();
    await page.evaluate((ids) => {
      const atlas = (window as unknown as AtlasWindow).__atlas;
      atlas.reset();
      const map = atlas.map;
      for (const id of ["pins", "pin-halos", "place-labels"])
        if (!map.getLayer(id)) throw new Error(`Missing published place layer: ${id}`);
      // Reuse actual public features and the app's palette, not a second overlay.
      // These context-local overrides expose entries without a city-level zoom.
      map.setPaintProperty("pins", "circle-opacity", ["*", 0.95, ["coalesce", ["feature-state", "visibility"], 1]]);
      map.setPaintProperty("pins", "circle-stroke-opacity", ["*", 0.8, ["coalesce", ["feature-state", "visibility"], 1]]);
      map.setPaintProperty("pins", "circle-radius", 2.7);
      map.setPaintProperty("pin-halos", "circle-opacity", ["*", 0.25, ["coalesce", ["feature-state", "visibility"], 1]]);
      map.setPaintProperty("pin-halos", "circle-radius", 7);
      map.setPaintProperty("place-labels", "text-opacity", ["*", 0.95, ["coalesce", ["feature-state", "visibility"], 1]]);
      map.setFilter("place-labels", ["in", ["get", "id"], ["literal", ids]]);
      map.setLayoutProperty("place-labels", "text-size", 12);
      map.setLayoutProperty("place-labels", "symbol-sort-key", ["index-of", ["get", "id"], ["literal", ids]]);
      // Retain the app's fixed text anchor: variable anchors visibly hop sides.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, stops.map((stop) => stop.id));
    await settle(page);
    await page.getByRole("dialog", { name: "Place", exact: true }).waitFor({ state: "hidden" });
    const tour = createGlobeTour(stops, viewport);
    // Confirm every representative is present in the live, all-years map.
    for (const stop of stops) {
      await camera(page, stop.coordinates, tour.overviewZoom, 0);
      const visible = await page.evaluate(({ id, coordinates }) => {
        const map = (window as unknown as AtlasWindow).__atlas.map;
        // Query the projected pin: a full-viewport box crosses the globe's
        // horizon and can miss features even when they are visibly on screen.
        return map.queryRenderedFeatures(map.project(coordinates), { layers: ["pins"] })
          .some((feature) => feature.id === id);
      }, stop);
      if (!visible) throw new Error(`The live app cannot show ${stop.label} (${stop.id}).`);
      await health();
    }
    // Warm both regional detail and the broad transfer before frame production.
    for (const { camera: state } of tour.keyframes)
      await camera(page, state.center, state.zoom, 0);
    let poster: Buffer | undefined;
    async function* frames() {
      let previous: CameraState | undefined;
      let buffer: Buffer | undefined;
      for (let frame = 0; frame < 720; frame++) {
        signal.throwIfAborted();
        if (errors.length) throw new Error(errors.join("\n"));
        const state = cameraAtFrame(frame, tour);
        // Hold cameras share one exact state. Reuse their settled PNG, while
        // every moving sample still positions, settles and captures the map.
        if (state !== previous || !buffer) {
          await camera(page, state.center, state.zoom, 0);
          await health();
          buffer = await page.screenshot({ type: "png", fullPage: false, scale: "device", caret: "hide", timeout: 30000 });
          await health();
          if (frame === 0) {
            const png = PNG.sync.read(buffer);
            if (png.width !== size.width || png.height !== size.height)
              throw new Error(`PNG dimensions ${png.width}x${png.height}, expected ${size.width}x${size.height}.`);
          }
          previous = state;
        }
        if (frame === tour.posterFrame) poster = buffer;
        if (frame % 30 === 0 || frame === 719) console.log(`${format}: frame ${frame + 1}/720`);
        yield buffer;
      }
    }
    const destination = resolve(directory, `${format}.mp4`);
    await encodeVideo(frames(), destination, size, signal);
    completed.push(destination);
    if (!poster) throw new Error("Regional poster was not captured.");
    const posterPath = resolve(directory, `${format}-poster.png`);
    await writeFile(posterPath, poster, { flag: "wx" });
    completed.push(posterPath);
    return [destination, posterPath];
  } finally {
    await context.close();
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    format: { type: "string", default: "all" }, place: { type: "string" },
    out: { type: "string" }, help: { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (values.format !== "all" && !Object.hasOwn(presets, values.format!))
    throw new Error("--format must be all, portrait, square or landscape. Use --help.");
  if (values.place !== undefined && !values.place.trim()) throw new Error("--place must not be empty.");
  if (values.out !== undefined && !values.out.trim()) throw new Error("--out must not be empty.");
  if (values.help) { console.log(help); return; }
  const directory = resolve(values.out ?? `recordings/${new Date().toISOString().replaceAll(":", "-")}-${randomBytes(4).toString("hex")}`);
  if (await exists(directory)) throw new Error(`Output directory already exists; refusing to overwrite: ${directory}`);
  const abort = new AbortController();
  const sigint = () => abort.abort(new Error("Recording interrupted by SIGINT."));
  const sigterm = () => abort.abort(new Error("Recording interrupted by SIGTERM."));
  process.on("SIGINT", sigint); process.on("SIGTERM", sigterm);
  let browser: Browser | undefined, server: VerificationServer | undefined;
  let closing = false;
  const completed: string[] = [];
  const closeBrowser = () => { void browser?.close().catch(() => {}); };
  abort.signal.addEventListener("abort", closeBrowser, { once: true });
  try {
    try {
      const encoders = await command("ffmpeg", ["-hide_banner", "-encoders"], abort.signal);
      await command("ffprobe", ["-version"], abort.signal);
      if (!/\blibx264\b/.test(encoders)) throw new Error("libx264 encoder unavailable");
    } catch (error) {
      throw new Error("Install FFmpeg including ffprobe and libx264 (macOS: brew install ffmpeg).", { cause: error });
    }
    try { await access(chromium.executablePath(), constants.X_OK); }
    catch (error) { throw new Error("Install Playwright Chromium: npx playwright install chromium", { cause: error }); }
    if (!process.env.npm_execpath) throw new Error("Launch through npm run record so npm_execpath is available.");
    await command(process.execPath, [process.env.npm_execpath, "run", "build"], abort.signal, true);
    const stops = await loadTour(values.place);
    console.log(`Featured public entries: ${stops.map((stop) => `${stop.label} (${stop.id})`).join(", ")}`);
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory); // Exclusive even if a competing process created it during the build.
    abort.signal.throwIfAborted();
    try { server = await startServer("dist", 4180); }
    catch (error) { throw new Error("Cannot start recorder on 127.0.0.1:4180; ensure the port is free. No unrelated process was stopped.", { cause: error }); }
    browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--disable-gpu"],
      // The CLI must finish encoder/file cleanup before exiting on a signal.
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--force-color-profile=srgb"] });
    browser.on("disconnected", () => {
      if (!closing && !abort.signal.aborted) abort.abort(new Error("Chromium closed before recording completed."));
    });
    abort.signal.throwIfAborted();
    const formats = values.format === "all" ? Object.keys(presets) as Format[] : [values.format as Format];
    for (const format of formats) {
      console.log(`Recording ${format} to ${directory}`);
      const paths = await recordFormat(browser, server.origin, format, stops, directory, abort.signal, completed);
      console.log(`Completed:\n${paths.join("\n")}`);
    }
    abort.signal.throwIfAborted();
    console.log(`Recording complete:\n${completed.join("\n")}`);
  } catch (error) {
    abort.abort(error);
    if (completed.length) console.error(`Preserved completed outputs:\n${completed.join("\n")}`);
    throw error;
  } finally {
    closing = true;
    try { await browser?.close(); }
    finally {
      await server?.close();
      abort.signal.removeEventListener("abort", closeBrowser);
      process.off("SIGINT", sigint); process.off("SIGTERM", sigterm);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
