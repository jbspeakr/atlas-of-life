import { spawn } from "node:child_process";
import { lstat, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Place } from "../src/map/create-map.ts";

export type CameraState = { center: [number, number]; zoom: number };
export type TourPlace = Pick<Place, "id" | "label" | "country" | "coordinates">;
export type GlobeTour = {
  keyframes: { frame: number; camera: CameraState }[];
  overviewZoom: number;
  regionZoom: number;
  posterFrame: number;
};

export function selectTourStops(places: readonly TourPlace[], anchor: TourPlace): TourPlace[] {
  if (!places.length || !places.some((place) => place.id === anchor.id))
    throw new RangeError("A globe tour needs a published anchor place.");
  const candidates = places.map((place) => {
    const longitude = place.coordinates[0] * Math.PI / 180;
    const latitude = place.coordinates[1] * Math.PI / 180;
    return { place, vector: [
      Math.cos(latitude) * Math.cos(longitude),
      Math.cos(latitude) * Math.sin(longitude),
      Math.sin(latitude),
    ] };
  });
  const selected = [candidates.find((candidate) => candidate.place.id === anchor.id)!];
  // Farthest-first on the sphere, preferring new countries over nearby repeats.
  // Dot products avoid treating entries either side of the dateline as far apart.
  while (selected.length < Math.min(4, candidates.length)) {
    let best: typeof candidates[number] | undefined;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (selected.some((stop) => stop.place.id === candidate.place.id)) continue;
      let distance = Infinity;
      for (const stop of selected) {
        const dot = candidate.vector.reduce((sum, value, axis) => sum + value * stop.vector[axis], 0);
        distance = Math.min(distance, 1 - dot);
      }
      const newCountry = !selected.some((stop) => stop.place.country === candidate.place.country);
      const score = distance + (newCountry ? 3 : 0);
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    if (!best) break;
    selected.push(best);
  }
  // Visit nearby representatives in sequence rather than zigzagging across them.
  const route = [selected.shift()!];
  while (selected.length) {
    const previous = route[route.length - 1];
    let nearest = 0, nearestDot = -Infinity;
    for (let i = 0; i < selected.length; i++) {
      const dot = previous.vector.reduce((sum, value, axis) => sum + value * selected[i].vector[axis], 0);
      if (dot > nearestDot) { nearest = i; nearestDot = dot; }
    }
    route.push(selected.splice(nearest, 1)[0]);
  }
  return route.map((stop) => stop.place);
}

export function createGlobeTour(
  stops: readonly TourPlace[],
  viewport: { width: number; height: number },
): GlobeTour {
  if (!stops.length) throw new RangeError("A globe tour needs at least one place.");
  const primary = stops[0].coordinates;
  let secondary = primary, greatestDistance = -1;
  const primaryLatitude = primary[1] * Math.PI / 180;
  for (const stop of stops.slice(1)) {
    const latitude = stop.coordinates[1] * Math.PI / 180;
    const longitudeDelta = (stop.coordinates[0] - primary[0]) * Math.PI / 180;
    const distance = Math.sin((latitude - primaryLatitude) / 2) ** 2 +
      Math.cos(primaryLatitude) * Math.cos(latitude) * Math.sin(longitudeDelta / 2) ** 2;
    if (distance > greatestDistance) { secondary = stop.coordinates; greatestDistance = distance; }
  }
  const overviewZoom = viewport.height > viewport.width ? 1.35 : viewport.width > viewport.height ? 1.05 : 0.8;
  // At 4.25+ the real region layers are fully visible. Stay within the archive's
  // global z0–6 coverage, well below the city/street-level extract windows.
  const regionZoom = viewport.width === viewport.height ? 4.75 : 5;
  const primaryWide: CameraState = { center: primary, zoom: overviewZoom };
  const primaryRegion: CameraState = { center: primary, zoom: regionZoom };
  const primaryTravel: CameraState = { center: primary, zoom: 2.25 };
  const secondaryTravel: CameraState = { center: secondary, zoom: 2.25 };
  const secondaryRegion: CameraState = { center: secondary, zoom: regionZoom };
  return {
    overviewZoom, regionZoom, posterFrame: 202,
    keyframes: [
      { frame: 0, camera: { center: [primary[0] - 18, primary[1]], zoom: overviewZoom } },
      { frame: 59, camera: primaryWide },
      { frame: 179, camera: primaryRegion },
      { frame: 224, camera: primaryRegion },
      { frame: 314, camera: primaryTravel },
      { frame: 434, camera: secondaryTravel },
      { frame: 539, camera: secondaryRegion },
      { frame: 584, camera: secondaryRegion },
      { frame: 719, camera: { center: secondary, zoom: overviewZoom } },
    ],
  };
}

export function cameraAtFrame(frame: number, tour: GlobeTour): CameraState {
  if (!Number.isInteger(frame) || frame < 0 || frame >= 720)
    throw new RangeError("Frame must be an integer from 0 through 719.");
  const keys = tour.keyframes;
  if (frame === 0) return keys[0].camera;
  let index = 1;
  while (frame > keys[index].frame) index++;
  if (frame === keys[index].frame) return keys[index].camera;
  const from = keys[index - 1], to = keys[index];
  if (from.camera === to.camera) return from.camera;
  const t = (frame - from.frame) / (to.frame - from.frame);
  // Minimum-jerk easing: velocity AND acceleration reach zero at every join.
  // Separate pan and dolly shots prevent sideways drift during regional dives.
  const s = t * t * t * (t * (t * 6 - 15) + 10);
  const a = from.camera.center, b = to.camera.center;
  const longitudeDelta = ((b[0] - a[0] + 180) % 360 + 360) % 360 - 180;
  return {
    center: a[0] === b[0] && a[1] === b[1] ? a :
      [a[0] + longitudeDelta * s, a[1] + (b[1] - a[1]) * s],
    zoom: from.camera.zoom + (to.camera.zoom - from.camera.zoom) * s,
  };
}

export async function encodeVideo(
  frames: AsyncIterable<Buffer>,
  destination: string,
  size: { width: number; height: number },
  signal: AbortSignal,
): Promise<void> {
  if (!destination.endsWith(".mp4")) throw new Error("Video destination must end in .mp4.");
  destination = resolve(destination);
  const partial = destination.slice(0, -4) + ".partial.mp4";
  for (const path of [destination, partial]) {
    try {
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`Refusing to overwrite existing media: ${path}`);
  }
  signal.throwIfAborted();
  const encoder = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-n",
    "-f", "image2pipe", "-framerate", "30", "-vcodec", "png", "-i", "pipe:0",
    "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
    // FFmpeg 9 can replace output flags with unspecified input-frame metadata.
    // Set frame tags too, after the dimension-preserving range conversion.
    "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    "-r", "30", "-movflags", "+faststart", partial,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "", inputClosed = false, exited = false, spawned = false;
  let failure: Error | undefined;
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => { rejectFailure = reject; });
  void failed.catch(() => {});
  const fail = (error: Error) => {
    if (!failure) { failure = error; rejectFailure(error); }
  };
  encoder.once("spawn", () => { spawned = true; });
  encoder.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192); });
  encoder.on("error", (error) => fail(new Error(`Cannot start FFmpeg: ${error.message}`, { cause: error })));
  encoder.stdin.on("error", (error) => fail(new Error(`FFmpeg input failed: ${error.message}`, { cause: error })));
  const closed = new Promise<void>((accept) => {
    encoder.once("close", (code, killed) => {
      exited = true;
      if (code !== 0 || !inputClosed)
        fail(new Error(`FFmpeg ${inputClosed ? "failed" : "exited before all frames"} (${killed ?? code}).`));
      accept();
    });
  });
  const abort = () => fail(signal.reason instanceof Error ? signal.reason : new Error("Encoding aborted."));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const iterator = frames[Symbol.asyncIterator]();
  let consumed = false, promoted = false;
  try {
    let count = 0;
    while (true) {
      const next = await Promise.race([iterator.next(), failed]);
      if (next.done) { consumed = true; break; }
      if (++count > 720) throw new Error("Frame stream exceeded 720 frames.");
      // Writable callbacks bound memory and honor backpressure; process/input
      // failure also interrupts a blocked write rather than waiting for drain.
      await Promise.race([new Promise<void>((accept, reject) => {
        encoder.stdin.write(next.value, (error) => error ? reject(error) : accept());
      }), failed]);
    }
    if (count !== 720) throw new Error(`Expected 720 frames, received ${count}.`);
    inputClosed = true;
    encoder.stdin.end();
    await Promise.race([closed, failed]);
    if (failure) throw failure;
    signal.throwIfAborted();

    const probe = spawn("ffprobe", [
      "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", partial,
    ], { stdio: ["ignore", "pipe", "pipe"], signal, killSignal: "SIGKILL" });
    let json = "", probeErrors = "";
    probe.stdout.on("data", (data: Buffer) => { json = (json + data.toString()).slice(-131072); });
    probe.stderr.on("data", (data: Buffer) => { probeErrors = (probeErrors + data.toString()).slice(-8192); });
    await new Promise<void>((accept, reject) => {
      probe.once("error", reject);
      probe.once("close", (code) => code === 0 ? accept() :
        reject(new Error(`ffprobe failed (${code}): ${probeErrors}`)));
    });
    const result = JSON.parse(json);
    const streams = result.streams;
    const stream = streams?.[0];
    if (!Array.isArray(streams) || streams.length !== 1 || stream.codec_type !== "video" ||
        stream.codec_name !== "h264" || stream.pix_fmt !== "yuv420p" ||
        stream.width !== size.width || stream.height !== size.height ||
        stream.avg_frame_rate !== "30/1" || Number(stream.nb_read_frames) !== 720 ||
        !Number.isFinite(Number(result.format?.duration)) ||
        stream.color_primaries !== "bt709" || stream.color_transfer !== "bt709" ||
        stream.color_space !== "bt709" || stream.color_range !== "tv" ||
        Math.abs(Number(result.format.duration) - 24) > 1 / 30)
      throw new Error(`Encoded video failed validation: ${json}`);
    signal.throwIfAborted();
    await rename(partial, destination);
    promoted = true;
  } catch (error) {
    throw new Error(`Could not encode ${destination}: ${error instanceof Error ? error.message : String(error)}${stderr ? `\nFFmpeg: ${stderr}` : ""}`, { cause: error });
  } finally {
    signal.removeEventListener("abort", abort);
    if (!consumed) {
      // Browser I/O may still be pending. Request closure without delaying
      // failure propagation; the caller then closes/aborts its browser.
      void iterator.return?.().catch(() => {});
    }
    encoder.stdin.destroy();
    if (!exited) {
      encoder.kill("SIGTERM");
      const force = setTimeout(() => encoder.kill("SIGKILL"), 2000);
      await closed;
      clearTimeout(force);
    }
    if (spawned && !promoted) await rm(partial, { force: true });
  }
}
