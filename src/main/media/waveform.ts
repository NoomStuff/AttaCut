import { fileURLToPath } from "node:url";
import type { ProbedSource } from "./probe.ts";
import { binaryPath } from "./process.ts";
import { scheduleMedia, observeForegroundMedia } from "./scheduler.ts";
import { recordDiagnostic } from "../diagnostics";
import type { WaveformChunk, WaveformResult, WaveformTimings } from "./waveform-decode.ts";

/** The worker owns FFmpeg, PCM reduction and disk caching. Main only forwards bounded peaks. */
export function extractWaveform(
   source: ProbedSource,
   tracks: number[],
   signal: AbortSignal | undefined,
   onChunk: (chunk: WaveformChunk) => void,
   options: {
      folder: string;
      decodePath?: string;
      activity?: (listener: (busy: boolean) => void) => () => void;
      region?: (listener: (from: number, to: number) => void) => () => void;
   }
): Promise<WaveformResult | null> {
   return scheduleMedia(
      async () => {
         // A separate handle table prevents Windows decoders spawned on different
         // threads from inheriting pipe ends and delaying each other's EOF.
         const { utilityProcess } = await import("electron");
         return new Promise<WaveformResult | null>((resolve, reject) => {
            signal?.throwIfAborted();
            const started = performance.now();
            const worker = utilityProcess.fork(fileURLToPath(new URL("./waveform-worker.js", import.meta.url)), [], { serviceName: "Waveform extraction" });
            worker.postMessage({ type: "init", source, tracks, folder: options.folder, decodePath: options.decodePath, ffmpeg: binaryPath("ffmpeg") });
            let finished = false;
            let first = false;
            let consumerError: Error | undefined;
            let resumeTimer: NodeJS.Timeout | undefined;
            let foregroundBusy = false;
            let editorBusy = false;
            const update = () => {
               clearTimeout(resumeTimer);
               if (foregroundBusy || editorBusy) worker.postMessage({ type: "pause" });
               else resumeTimer = setTimeout(() => worker.postMessage({ type: "resume" }), 750);
            };
            const unobserve = observeForegroundMedia((busy) => {
               foregroundBusy = busy;
               update();
            });
            const unwatch = options.activity?.((busy) => {
               editorBusy = busy;
               update();
            });
            const unregion = options.region?.((from, to) => worker.postMessage({ type: "region", from, to }));
            const abort = () => worker.postMessage({ type: "cancel" });
            signal?.addEventListener("abort", abort, { once: true });
            const finish = (result: WaveformResult | null, error?: Error) => {
               if (finished) return;
               finished = true;
               clearTimeout(resumeTimer);
               unobserve();
               unwatch?.();
               unregion?.();
               signal?.removeEventListener("abort", abort);
               worker.kill();
               if (signal?.aborted) reject(new Error("Cancelled"));
               else if (consumerError || error) reject(consumerError ?? error);
               else {
                  recordDiagnostic("waveform:decode", performance.now() - started);
                  resolve(result);
               }
            };
            worker.on(
               "message",
               (
                  message:
                     | (WaveformChunk & { type: "chunk" })
                     | { type: "done"; result: WaveformResult | null; timings?: WaveformTimings; pausedMs: number; priorityMs: number }
                     | { type: "error"; message: string }
               ) => {
                  if (message.type === "chunk") {
                     try {
                        if (!signal?.aborted) {
                           if (!first) {
                              first = true;
                              recordDiagnostic("waveform:first-chunk", performance.now() - started);
                           }
                           onChunk({ offset: message.offset, peaks: message.peaks, rate: message.rate, ...(message.priority ? { priority: true } : {}) });
                        }
                        worker.postMessage({ type: "ack" });
                     } catch (error) {
                        consumerError = error instanceof Error ? error : new Error(String(error));
                        abort();
                     }
                  } else if (message.type === "done") {
                     recordDiagnostic("waveform:paused", message.pausedMs);
                     recordDiagnostic("waveform:priority", message.priorityMs);
                     if (message.timings) {
                        recordDiagnostic("waveform:encode", message.timings.encodeMs);
                        recordDiagnostic("waveform:delivery", message.timings.deliveryMs);
                        recordDiagnostic(
                           "waveform:read-decode",
                           Math.max(0, message.timings.totalMs - message.timings.encodeMs - message.timings.deliveryMs - message.timings.waitingMs)
                        );
                     }
                     finish(message.result);
                  } else finish(null, new Error(message.message));
               }
            );
            worker.once("error", () => finish(null, new Error("Waveform helper failed")));
            worker.once("exit", () => {
               if (!finished) finish(null, new Error("Waveform worker stopped before completion"));
            });
            if (signal?.aborted) abort();
         });
      },
      "background",
      signal
   );
}
