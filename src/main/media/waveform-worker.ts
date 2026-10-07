import { stat } from "node:fs/promises";
import type { ProbedSource } from "./probe.ts";
import { decodeWaveform } from "./waveform-decode.ts";
import type { WaveformChunk, WaveformTimings } from "./waveform-decode.ts";
import { cachedWaveform, waveformCacheKey } from "./waveform-cache.ts";
import { waveformResolution } from "../../shared/media.ts";
import { WaveformGate } from "./waveform-gate.ts";
import { WaveformPriority } from "./waveform-priority.ts";

const parentPort = process.parentPort;
const { source, tracks, decodePath, folder, ffmpeg } = await new Promise<{
   source: ProbedSource;
   tracks: number[];
   decodePath?: string;
   folder: string;
   ffmpeg: string;
}>((resolve) => parentPort.once("message", ({ data }) => resolve(data)));
process.env["FFMPEG_PATH"] = ffmpeg;
const controller = new AbortController();
const gate = new WaveformGate();
const priority = new WaveformPriority(source.duration, controller.signal);
let covered = 0;
let pausedMs = 0;
let priorityMs = 0;
let timings: WaveformTimings | undefined;
let cacheHit = false;
let acknowledge = () => {};
parentPort.on("message", ({ data }: { data: { type: "pause" | "resume" | "cancel" | "ack" } | { type: "region"; from: number; to: number } }) => {
   const message = data;
   if (message.type === "cancel") {
      controller.abort();
      gate.close();
      acknowledge();
   }
   if (message.type === "pause") gate.pause();
   if (message.type === "resume") gate.resume();
   if (message.type === "ack") acknowledge();
   if (message.type === "region") priority.request(message.from, message.to);
});
const waitActivity = async () => {
   const start = performance.now();
   await gate.wait();
   pausedMs += performance.now() - start;
   controller.signal.throwIfAborted();
};
const send = async (chunk: WaveformChunk) => {
   // Send an owned, bounded chunk. Acknowledgement prevents an unbounded main-thread queue.
   const peaks = Uint8Array.from(chunk.peaks);
   await new Promise<void>((resolve) => {
      acknowledge = resolve;
      // Utility messages clone this bounded chunk. Isolating FFmpeg's pipes matters
      // more than avoiding a small peak copy between processes.
      parentPort.postMessage({ type: "chunk", ...chunk, peaks });
   });
   controller.signal.throwIfAborted();
};
const wait = async () => {
   await waitActivity();
   if (!cacheHit)
      await priority.read(covered, async (range, signal) => {
         const start = performance.now();
         const beforePaused = pausedMs;
         try {
            await decodeWaveform(
               source,
               tracks,
               signal,
               async (chunk) => {
                  await waitActivity();
                  signal.throwIfAborted();
                  await send({ ...chunk, priority: true });
               },
               { ...(decodePath ? { decodePath } : {}), wait: waitActivity, range }
            );
         } finally {
            priorityMs += performance.now() - start - (pausedMs - beforePaused);
         }
      });
   controller.signal.throwIfAborted();
};
const consume = async (chunk: WaveformChunk) => {
   await wait();
   await send(chunk);
   covered = (chunk.offset + chunk.peaks.length / 3) / chunk.rate;
};
try {
   await waitActivity();
   const inputInfo = await stat(source.path);
   if (
      inputInfo.size !== source.size ||
      inputInfo.mtimeMs !== source.modified ||
      (source.fileIdentity && (source.fileIdentity.device !== inputInfo.dev || source.fileIdentity.inode !== inputInfo.ino))
   )
      throw new Error("Source changed before waveform decode");
   const preview = decodePath ? await stat(decodePath).then((info) => ({ path: decodePath, size: info.size, mtimeMs: info.mtimeMs })) : undefined;
   const key = waveformCacheKey(source, tracks, preview);
   const result = await cachedWaveform(
      folder,
      key,
      waveformResolution(source.duration),
      source.duration,
      controller.signal,
      consume,
      async (write) => {
         // On a cache miss, serve an already requested edit before starting the
         // sequential decoder. Avoid competing reads when opening at a distant time.
         await wait();
         const result = await decodeWaveform(source, tracks, controller.signal, write, {
            ...(decodePath ? { decodePath } : {}),
            wait,
            measure: (value) => {
               timings = value;
            },
         });
         const after = await stat(source.path);
         if (after.size !== inputInfo.size || after.mtimeMs !== inputInfo.mtimeMs || after.dev !== inputInfo.dev || after.ino !== inputInfo.ino)
            throw new Error("Source changed during waveform decode");
         return result;
      },
      () => {
         cacheHit = true;
      }
   );
   parentPort.postMessage({ type: "done", result, timings, pausedMs, priorityMs });
} catch (error) {
   parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
}
// Main closes the helper after receiving its final message. Exiting here could
// race delivery of that final message.
