import { spawn } from "node:child_process";
import { lstat, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

export type { CameraState, GlobeTour, TourPlace } from "../src/map/tour.ts";
export { cameraAtFrame, createGlobeTour, selectTourStops, tourCandidates } from "../src/map/tour.ts";

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
