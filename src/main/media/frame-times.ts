import { packetsAround, sourceFrames } from "./probe";
import type { ProbedSource } from "./probe";

/** Preview navigation and frame export resolve against the same source timestamps. */
export async function frameTimesAround(source: ProbedSource, time: number, signal?: AbortSignal): Promise<Float64Array | number[]> {
   const frames = await sourceFrames(source, signal).catch(() => null);
   // A cancelled index must not start another probe under a new source's lifetime.
   signal?.throwIfAborted();
   return frames ?? (await packetsAround(source, time, signal, "seek")).map((point) => point.time);
}
