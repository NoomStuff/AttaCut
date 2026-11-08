import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { Readable } from "node:stream";
import { primaryVideo } from "../../shared/types";
import type { ProbedSource } from "./probe.ts";
import { binaryPath } from "./process.ts";
import { frameTimesAround } from "./frame-times.ts";
import { packetsAround, sourceFrames, sourceKeyframes } from "./probe.ts";
import { previewVideoFilter } from "./preview.ts";
import { Fmp4Retimer } from "./fmp4-retime.ts";
import { recordDiagnostic } from "../diagnostics";

/** Streams encode in real time beside playback; this width keeps that cheap, like preview files. */
const streamWidth = 1280;

/** The last frame at or before `time`: the picture a viewer expects to see there. */
export function frameAtOrBefore(frames: ArrayLike<number>, time: number): number {
   let low = 0;
   let high = frames.length - 1;
   if (high < 0 || time <= frames[0]!) return frames[0] ?? 0;
   while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (frames[middle]! <= time + 1e-6) low = middle;
      else high = middle - 1;
   }
   return frames[low]!;
}

/** Audio for a stream starting at `start` (source timeline): every selected track is aligned
    to that instant on absolute timestamps, mixed, and padded to the end of the recording. */
function streamAudio(source: ProbedSource, tracks: number[], start: number): string[] {
   if (!tracks.length) return ["-an"];
   const selected = source.streams.filter((stream) => tracks.includes(stream.index));
   const rate = Math.max(48000, ...selected.map((stream) => stream.sampleRate ?? 0));
   const layout = [...selected].sort((a, b) => (b.channels ?? 0) - (a.channels ?? 0))[0]?.channelLayout;
   const from = start + source.startOffset;
   const align = `atrim=start=${from.toFixed(6)},aresample=${rate}:async=1:first_pts=${Math.round(from * rate)}`;
   const end = `apad,atrim=end=${(source.startOffset + source.duration).toFixed(6)}`;
   const inputs = tracks.map((index, i) => `[0:${index}]${align}[t${i}]`).join(";");
   const mixed =
      tracks.length === 1
         ? `[t0]${end}[a]`
         : `${tracks.map((_, i) => `[t${i}]`).join("")}amix=inputs=${tracks.length}:duration=longest${layout ? `,aformat=channel_layouts=${layout}` : ""},${end}[a]`;
   return ["-filter_complex", `${inputs};${mixed}`, "-map", "[a]"];
}

/**
 * Timestamps stay absolute (`-copyts`) and both tracks are trimmed on them, the same way
 * frame export finds a frame. A demuxer seek only gets close; the trim makes it exact.
 */
export function streamArguments(source: ProbedSource, tracks: number[], videoStart: number, audioStart: number, seek: number): string[] {
   const video = primaryVideo(source)!;
   const fps = video.frameRate > 0 && video.frameRate < 240 ? video.frameRate : 30;
   const trim = videoStart > 0 ? `trim=start=${(videoStart + source.startOffset - 0.0001).toFixed(6)},` : "";
   // The probe branch logs the first kept frame, so a seek that lands late is caught.
   const picture = `[0:${video.index}]${trim}split=2[picture][probe];[probe]trim=end_frame=1,showinfo,nullsink;[picture]${previewVideoFilter(video, streamWidth)}[v]`;
   const audio = streamAudio(source, tracks, audioStart);
   return [
      "-hide_banner",
      "-loglevel",
      "info",
      "-nostats",
      "-nostdin",
      ...(process.platform === "linux" ? [] : ["-hwaccel", "auto"]),
      "-copyts",
      ...(seek > 0 ? ["-ss", seek.toFixed(6)] : []),
      "-i",
      source.path,
      "-filter_complex",
      audio[0] === "-filter_complex" ? `${picture};${audio[1]}` : picture,
      "-map",
      "[v]",
      ...(audio[0] === "-filter_complex" ? audio.slice(2) : audio),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-crf",
      "21",
      "-bf",
      "0",
      // One keyframe a second keeps restarts and evictions cheap without bloating the stream.
      "-g",
      String(Math.max(12, Math.round(fps))),
      "-pix_fmt",
      "yuv420p",
      "-fps_mode",
      "passthrough",
      ...(tracks.length ? ["-c:a", "flac", "-compression_level", "0"] : []),
      "-f",
      "mp4",
      "-movflags",
      "+frag_keyframe+empty_moov+default_base_moof",
      "-frag_duration",
      "100000",
      "pipe:1",
   ];
}

async function keyframeAtOrBefore(source: ProbedSource, time: number, signal: AbortSignal): Promise<number | null> {
   const indexed = await sourceFrames(source, signal).catch(() => null);
   const latest = (keys: number[]) => {
      let found: number | null = null;
      for (const key of keys) if (key <= time + 1e-6 && (found === null || key > found)) found = key;
      return found;
   };
   if (indexed) return latest(await sourceKeyframes(source, signal));
   const keys = async (at: number) => (await packetsAround(source, at, signal, "seek")).filter((point) => point.key).map((point) => point.time);
   // A time just after a window boundary can have its keyframe in the previous window.
   return latest(await keys(time)) ?? (time >= 1 ? latest(await keys(Math.max(0, time - 12))) : null);
}

interface Attempt {
   child: ChildProcessByStdio<null, Readable, Readable>;
   /** Output produced before the first frame was known, replayed into the retimer. */
   held: Buffer[];
   /** Source time of the first video frame, or null when the stream has no picture left. */
   firstFrame: number | null;
   stderr: () => string;
}

/** Start FFmpeg and wait until it reports which frame it really started on. */
function attempt(source: ProbedSource, args: string[], signal: AbortSignal): Promise<Attempt> {
   return new Promise((resolve, reject) => {
      const child = spawn(binaryPath("ffmpeg"), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const held: Buffer[] = [];
      let log = "";
      let pending = "";
      let settled = false;
      const stop = () => child.kill();
      signal.addEventListener("abort", stop, { once: true });
      const result = (firstFrame: number | null) => {
         if (settled) return;
         settled = true;
         child.stdout.pause();
         child.stdout.off("data", hold);
         resolve({ child, held, firstFrame, stderr: () => log });
      };
      const hold = (chunk: Buffer) => held.push(chunk);
      child.stdout.on("data", hold);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (text: string) => {
         log = (log + text).slice(-4000);
         if (settled) return;
         pending += text;
         const lines = pending.split(/\r?\n/);
         pending = lines.pop() ?? "";
         for (const line of lines) {
            const match = /Parsed_showinfo.* pts_time:(-?[\d.]+)/.exec(line);
            if (match) return result(Number(match[1]) - source.startOffset);
         }
      });
      child.on("error", (error) => {
         if (!settled) {
            settled = true;
            reject(error);
         }
      });
      child.on("close", (code) => {
         signal.removeEventListener("abort", stop);
         if (settled) return;
         if (code === 0) return result(null);
         settled = true;
         reject(signal.aborted ? new Error("Cancelled") : new Error(lastError(log) || `ffmpeg exited with code ${code}`));
      });
   });
}

function lastError(log: string): string {
   return log
      .split(/\r?\n/)
      .filter((line) => line && !/^\s|^(Input|Output|Stream mapping|Press)|Parsed_showinfo/.test(line))
      .slice(-3)
      .join("\n");
}

/**
 * A playable fragmented MP4 of the source from `from` onward. FLAC carries the audio
 * because it has no encoder delay, so both tracks start exactly where they are placed.
 * The child pauses with the consumer, so only what is watched gets decoded.
 */
export async function streamPreview(source: ProbedSource, tracks: number[], from: number, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
   const frames = await frameTimesAround(source, Math.max(0, from), signal);
   signal.throwIfAborted();
   // Start on the frame shown at `from`; audio starts there too so nothing before it plays.
   const first = Math.max(0, frameAtOrBefore(frames, Math.max(0, from)));
   const audio = Math.min(Math.max(0, from), first);
   const started = performance.now();
   let run: Attempt | null = null;
   // Demuxers without an index (MPEG-TS and program streams) can land a GOP or more past a
   // seek. A late first frame retries from further back, ending with a read from the start.
   // A millisecond past the keyframe lands on it in both indexed and MPEG-TS demuxers,
   // so only the frames between it and `first` are decoded before the trim.
   const keyframe = await keyframeAtOrBefore(source, first, signal);
   const start = Math.min(first, audio);
   const seeks = [keyframe === null ? start - 0.25 : Math.min(start, keyframe + 0.001), start - 3, start - 15, 0];
   for (const [index, seek] of seeks.entries()) {
      if (index > 0 && seek > 0 && seek >= seeks[index - 1]!) continue;
      run = await attempt(source, streamArguments(source, tracks, first, audio, seek), signal);
      if (run.firstFrame === null || run.firstFrame <= first + 0.001 || seek <= 0) break;
      run.child.kill();
      run = null;
   }
   const { child, held, firstFrame, stderr } = run!;
   recordDiagnostic("preview:stream-first", performance.now() - started);
   const retimer = new Fmp4Retimer({ video: firstFrame ?? first, audio });
   for (const chunk of held) retimer.write(chunk);
   child.on("close", (code) => {
      if (code !== 0 && !signal.aborted) retimer.destroy(new Error(lastError(stderr()) || `ffmpeg exited with code ${code}`));
   });
   if (child.exitCode !== null && child.exitCode !== 0 && !signal.aborted) retimer.destroy(new Error(lastError(stderr()) || "ffmpeg stopped"));
   child.stdout.pipe(retimer);
   child.stdout.resume();
   retimer.on("close", () => {
      if (child.exitCode === null) child.kill();
   });
   return Readable.toWeb(retimer) as ReadableStream<Uint8Array>;
}
