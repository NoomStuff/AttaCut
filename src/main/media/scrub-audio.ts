import { spawn } from "node:child_process";
import type { ProbedSource } from "./probe.ts";
import { binaryPath } from "./process.ts";

/** Keep only a short working set, independent of recording length. */
const sampleRate = 22050;
export const scrubChunkSeconds = 30;

export async function extractScrubPcm(
   source: ProbedSource,
   streamIndices: number[],
   signal?: AbortSignal,
   start = 0
): Promise<{ sampleRate: number; pcm: ArrayBuffer; start: number } | null> {
   const tracks = source.streams.filter((stream) => stream.type === "audio" && !stream.attachedPicture);
   const selected = streamIndices.map((index) => tracks.findIndex((stream) => stream.index === index));
   if (!selected.length || selected.some((track) => track < 0)) return null;
   const limit = sampleRate * 2 * scrubChunkSeconds + 4096;
   return new Promise((resolve, reject) => {
      const child = spawn(
         binaryPath("ffmpeg"),
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
            ...(selected.length === 1
               ? ["-map", `0:a:${selected[0]}`]
               : ["-filter_complex", `${selected.map((track) => `[0:a:${track}]`).join("")}amix=inputs=${selected.length}:duration=longest[a]`, "-map", "[a]"]),
            "-ac",
            "1",
            "-ar",
            String(sampleRate),
            "-f",
            "s16le",
            "-",
         ],
         { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal }
      );
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = "";
      let failure: Error | null = null;
      child.stdout.on("data", (chunk: Buffer) => {
         size += chunk.length;
         if (size > limit) {
            failure = new Error("Scrub audio exceeded its memory budget.");
            child.kill();
            return;
         }
         chunks.push(chunk);
      });
      child.stderr.on("data", (data: Buffer) => {
         stderr = (stderr + data).slice(-4000);
      });
      child.on("error", (error) => {
         failure = error.message.includes("ENOENT") ? new Error("FFmpeg was not found.") : error;
      });
      child.on("close", (code) => {
         if (signal?.aborted) return reject(new Error("Cancelled"));
         if (failure) return reject(failure);
         if (code !== 0) return reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
         const pcm = new Uint8Array(size);
         let offset = 0;
         for (const chunk of chunks) {
            pcm.set(chunk, offset);
            offset += chunk.length;
         }
         resolve({ sampleRate, pcm: pcm.buffer, start });
      });
   });
}
