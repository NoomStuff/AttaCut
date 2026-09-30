import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";

const sampleRate = 22050;
export const scrubChunkSeconds = 30;

export async function extractScrubPcm(
   source: ProbedSource,
   streamIndices: number[],
   signal?: AbortSignal,
   start = 0
): Promise<{ sampleRate: number; pcm: ArrayBuffer; start: number } | null> {
   const available = new Set(source.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index));
   if (!streamIndices.length || streamIndices.some((index) => !available.has(index))) return null;
   const chunks: Buffer[] = [];
   let size = 0;
   await runMedia(
      "ffmpeg",
      [
         "-hide_banner",
         "-loglevel",
         "error",
         "-nostdin",
         "-ss",
         String(start),
         "-i",
         source.path,
         "-t",
         String(scrubChunkSeconds),
         "-vn",
         ...(streamIndices.length === 1
            ? ["-map", `0:${streamIndices[0]}`]
            : [
                 "-filter_complex",
                 `${streamIndices.map((index) => `[0:${index}]`).join("")}amix=inputs=${streamIndices.length}:duration=longest[a]`,
                 "-map",
                 "[a]",
              ]),
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
