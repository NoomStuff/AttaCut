import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";
import { scrubChunkSeconds } from "../../shared/media";
import { alignedAudioFilters } from "./audio-filter.ts";
export { scrubChunkSeconds } from "../../shared/media";

const sampleRate = 22050;

export async function extractScrubPcm(
   source: ProbedSource,
   streamIndices: number[],
   signal?: AbortSignal,
   start = 0
): Promise<{ sampleRate: number; pcm: ArrayBuffer; start: number } | null> {
   const available = new Set(source.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index));
   if (!streamIndices.length || streamIndices.some((index) => !available.has(index))) return null;
   const duration = Math.min(scrubChunkSeconds, source.duration - start);
   if (duration <= 0) return null;
   const layout = source.streams
      .filter((stream) => streamIndices.includes(stream.index))
      .sort((a, b) => (b.channels ?? 0) - (a.channels ?? 0))[0]?.channelLayout;
   const chunks: Buffer[] = [];
   let size = 0;
   await runMedia(
      "ffmpeg",
      [
         "-hide_banner",
         "-loglevel",
         "error",
         "-nostdin",
         "-threads",
         "1",
         "-ss",
         String(start),
         "-i",
         source.path,
         "-t",
         String(duration),
         "-vn",
         ...alignedAudioFilters(
            streamIndices.map((index) => `0:${index}`),
            sampleRate,
            layout,
            duration
         ),
         "-ac",
         "1",
         "-ar",
         String(sampleRate),
         "-f",
         "s16le",
         "-",
      ],
      {
         signal,
         onBytes: (chunk) => {
            size += chunk.length;
            if (size > sampleRate * 2 * scrubChunkSeconds + 4096) throw new Error("Scrub audio exceeded its memory budget.");
            chunks.push(chunk);
         },
      }
   );
   const pcm = new Uint8Array(size);
   let offset = 0;
   for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
   }
   return { sampleRate, pcm: pcm.buffer, start };
}
