import { spawn } from "node:child_process";
import type { ProbedSource } from "./probe.ts";
import { binaryPath } from "./process.ts";

/** Compact mono PCM for scrub bursts; 22 kHz keeps two hours under ~320 MB. */
const sampleRate = 22050;
const maxSeconds = 2 * 60 * 60;

export async function extractScrubPcm(
   source: ProbedSource,
   streamIndices: number[],
   signal?: AbortSignal
): Promise<{ sampleRate: number; pcm: ArrayBuffer } | null> {
   if (source.duration > maxSeconds) return null;
   const tracks = source.streams.filter((stream) => stream.type === "audio" && !stream.attachedPicture);
   const selected = streamIndices.map((index) => tracks.findIndex((stream) => stream.index === index));
   if (!selected.length || selected.some((track) => track < 0)) return null;
   const limit = sampleRate * 2 * Math.ceil(source.duration) + 4096;
   return new Promise((resolve, reject) => {
      const child = spawn(
         binaryPath("ffmpeg"),
         [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-i",
            source.path,
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
         resolve({ sampleRate, pcm: pcm.buffer });
      });
   });
}
