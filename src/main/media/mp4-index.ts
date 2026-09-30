import { Worker } from "node:worker_threads";
import { primaryVideo } from "../../shared/media";
import type { ProbedSource } from "./probe";
import { indexedSampleTimes as readSampleTimes } from "./mp4-sample-table";
import type { SampleTimes } from "./mp4-sample-table";

export type { SampleTimes } from "./mp4-sample-table";

/** Small files avoid worker startup. Large tables must not sort on Electron's main thread. */
export function indexedSampleTimes(source: ProbedSource, signal?: AbortSignal): Promise<SampleTimes | null> {
   signal?.throwIfAborted();
   const samples = source.duration * (primaryVideo(source)?.frameRate || 30);
   if (!process.versions.electron || samples < 200_000 || ![".mp4", ".m4v", ".mov"].includes(source.extension)) {
      return readSampleTimes(source, signal);
   }
   return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./media-index-worker.js", import.meta.url), { workerData: source });
      let settled = false;
      const finish = (result: SampleTimes | null, error?: unknown) => {
         if (settled) return;
         settled = true;
         signal?.removeEventListener("abort", abort);
         void worker.terminate();
         if (error) reject(error);
         else resolve(result);
      };
      const abort = () => finish(null, signal?.reason ?? new DOMException("Index cancelled", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      worker.once("message", (result: SampleTimes | null) => finish(result));
      // A failed optional index falls back to packet scanning, just like an unsupported table.
      worker.once("error", () => finish(null));
      worker.once("exit", () => finish(null));
      if (signal?.aborted) abort();
   });
}
