import { primaryVideo } from "../../shared/types";
import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";
import { probeSource, sourceFrames, ratio } from "./probe.ts";
import { isLosslessAudio } from "./mux";
import type { MediaStream } from "../../shared/types";

function audioPacketDuration(stream: MediaStream): number {
   if (isLosslessAudio(stream.codec)) return 1 / (stream.sampleRate || 48000);
   const samples =
      stream.codec === "aac" ? 1024 : stream.codec === "mp3" ? 1152 : ["ac3", "eac3"].includes(stream.codec) ? 1536 : stream.codec === "opus" ? 960 : 2048;
   return samples / (stream.sampleRate || 48000);
}

/** Check the promised stream inventory before making an output visible. */
export async function verifyOutputStructure(
   source: ProbedSource,
   output: string,
   audioTracks: number[],
   duration: number,
   signal?: AbortSignal,
   start = 0,
   ignoreTypes: readonly string[] = [],
   videoFrameDuration?: number,
   expectedFrameCount?: number
): Promise<void> {
   const actual = await probeSource(output, signal);
   const expected = source.streams.filter((stream) => (stream.type !== "audio" || audioTracks.includes(stream.index)) && !ignoreTypes.includes(stream.type));
   for (const type of new Set([...expected, ...actual.streams].map((stream) => stream.type))) {
      const before = expected.filter((stream) => stream.type === type);
      const after = actual.streams.filter((stream) => stream.type === type);
      if (before.length !== after.length) throw new Error(`The export did not preserve the expected ${type} tracks. No output was published.`);
      for (const [index, stream] of before.entries()) {
         const result = after[index]!;
         if (
            type === "attachment" &&
            source.attachmentHashes?.[stream.index] &&
            source.attachmentHashes[stream.index] !== actual.attachmentHashes?.[result.index]
         )
            throw new Error("The export changed an attachment. No output was published.");
         if (stream.attachedPicture) {
            if (!result.attachedPicture || (await preservedPictureHash(source, stream.index, signal)) !== (await pictureHash(output, result.index, signal)))
               throw new Error("The export changed a cover image. No output was published.");
         }
         if ((type === "video" || type === "audio") && stream.codec !== result.codec)
            throw new Error(`The export changed a ${type} codec. No output was published.`);
         if (
            type === "video" &&
            (stream.width !== result.width ||
               stream.height !== result.height ||
               stream.pixelFormat !== result.pixelFormat ||
               stream.rotation !== result.rotation)
         )
            throw new Error("The export changed the video format. No output was published.");
         if (
            type === "video" &&
            stream.sampleAspectRatio &&
            !["N/A", "0:1"].includes(stream.sampleAspectRatio) &&
            stream.sampleAspectRatio !== result.sampleAspectRatio
         )
            throw new Error("The export changed video pixel proportions. No output was published.");
         if (
            type === "audio" &&
            ((stream.sampleRate && stream.sampleRate !== result.sampleRate) ||
               (stream.channels && stream.channels !== result.channels) ||
               (stream.channelLayout && stream.channelLayout !== result.channelLayout))
         )
            throw new Error("The export changed the audio format. No output was published.");
         if ((type === "audio" || type === "subtitle") && stream.language && stream.language !== "und" && stream.language !== result.language)
            throw new Error("The export changed track language metadata. No output was published.");
         if (type === "audio" && stream.startTime !== undefined && result.startTime !== undefined) {
            const expectedStart = Math.max(0, stream.startTime - source.startOffset - start);
            const actualStart = Math.max(0, result.startTime - actual.startOffset);
            if (
               expectedStart < duration &&
               Math.abs(expectedStart - actualStart) > Math.max(audioPacketDuration(stream), ratio(stream.timeBase), ratio(result.timeBase)) * 2 + 0.0001
            )
               throw new Error("The export changed audio timing. No output was published.");
         }
         if (type === "video") {
            for (const key of ["colorTransfer", "colorPrimaries", "colorSpace", "colorRange", "masterDisplay", "maxCll"] as const) {
               const value = stream[key];
               if (value && value !== "unknown" && value !== "unspecified" && value !== result[key])
                  throw new Error("The export changed video color metadata. No output was published.");
            }
         }
      }
   }
   const video = primaryVideo(source);
   const frameDuration = videoFrameDuration ?? (video?.frameRate ? 1 / video.frameRate : 0);
   const packetDuration = Math.max(0, ...expected.filter((stream) => stream.type === "audio").map(audioPacketDuration));
   const tolerance = Math.max(frameDuration * 2, packetDuration * 2) + 0.002;
   if (Math.abs(actual.duration - duration) > tolerance) throw new Error("The exported duration does not match the selected clips. No output was published.");
   if (expectedFrameCount !== undefined) {
      const frames = await sourceFrames(actual, signal);
      if (frames && frames.length !== expectedFrameCount)
         throw new Error("The exported frame count does not match the selected clips. No output was published.");
   }
}

const referenceHashes = new WeakMap<ProbedSource, Map<number, string>>();
const pictureHashes = new WeakMap<ProbedSource, Map<number, string>>();
async function pictureHash(path: string, index: number, signal?: AbortSignal): Promise<string> {
   const result = await runMedia(
      "ffmpeg",
      ["-v", "error", "-i", path, "-map", `0:${index}`, "-c", "copy", "-frames:v", "1", "-f", "hash", "-hash", "sha256", "-"],
      { signal }
   );
   const hash = /^SHA256=([a-f0-9]{64})$/m.exec(result)?.[1];
   if (!hash) throw new Error("Could not verify the cover image. No output was published.");
   return hash;
}
async function preservedPictureHash(source: ProbedSource, index: number, signal?: AbortSignal): Promise<string> {
   let cache = pictureHashes.get(source);
   const cached = cache?.get(index);
   if (cached) return cached;
   const hash = await pictureHash(source.path, index, signal);
   signal?.throwIfAborted();
   if (!cache) {
      cache = new Map();
      pictureHashes.set(source, cache);
   }
   cache.set(index, hash);
   return hash;
}
async function referenceHash(source: ProbedSource, time: number, signal?: AbortSignal): Promise<string> {
   let cache = referenceHashes.get(source);
   const hash = cache?.get(time);
   if (hash) return hash;
   const result = await frameHash(source.path, time, source.startOffset, signal);
   signal?.throwIfAborted();
   if (!cache) {
      cache = new Map();
      referenceHashes.set(source, cache);
   }
   cache.set(time, result);
   if (cache.size > 128) cache.delete(cache.keys().next().value!);
   return result;
}
async function frameHash(path: string, time: number, offset: number, signal?: AbortSignal): Promise<string> {
   const seek = Math.max(0, time - 5);
   const result = await runMedia(
      "ffmpeg",
      [
         "-v",
         "error",
         "-copyts",
         ...(seek > 0 ? ["-ss", String(seek)] : []),
         "-noautorotate",
         "-i",
         path,
         "-map",
         "0:V:0",
         "-an",
         "-vf",
         `trim=start=${Math.max(0, time + offset - 0.0011)},setpts=PTS-STARTPTS`,
         "-frames:v",
         "1",
         "-fps_mode",
         "passthrough",
         "-f",
         "framemd5",
         "-",
      ],
      { signal }
   );
   const line = result.split("\n").find((item) => item && !item.startsWith("#"));
   if (!line) throw new Error("Could not verify a frame at the cut. The partial export was removed.");
   return line.split(",").at(-1)!.trim();
}
export async function verifyCopiedFrames(source: ProbedSource, output: string, start: number, times: number[], signal?: AbortSignal): Promise<void> {
   for (const time of times) {
      signal?.throwIfAborted();
      const [original, copy] = await Promise.all([referenceHash(source, time, signal), frameHash(output, time - start, 0, signal)]);
      if (original !== copy)
         throw new Error(
            "This file's frame dependencies could not be joined without changing copied video. Try a shorter clip. The partial export was removed."
         );
   }
}

/** Compare only encoded span endpoints, never decode the whole kept recording. */
export async function verifyEncodedFrames(source: ProbedSource, output: string, start: number, times: number[], signal?: AbortSignal): Promise<void> {
   for (const time of times) {
      const outputTime = time - start;
      const data = await runMedia(
         "ffmpeg",
         [
            "-v",
            "error",
            "-copyts",
            ...(time > 5 ? ["-ss", String(time - 5)] : []),
            "-noautorotate",
            "-i",
            source.path,
            ...(outputTime > 5 ? ["-ss", String(outputTime - 5)] : []),
            "-noautorotate",
            "-i",
            output,
            "-filter_complex",
            `[0:V:0]trim=start=${Math.max(0, time + source.startOffset - 0.0011)},setpts=PTS-STARTPTS[a];` +
               `[1:V:0]trim=start=${Math.max(0, outputTime - 0.0011)},setpts=PTS-STARTPTS[b];` +
               "[a][b]ssim,metadata=print:file=-",
            "-frames:v",
            "1",
            "-an",
            "-f",
            "null",
            "-",
         ],
         { signal }
      );
      const quality = Number(/lavfi\.ssim\.All=([\d.]+)/.exec(data)?.[1]);
      if (!Number.isFinite(quality) || quality < 0.9) throw new Error("An encoded boundary did not match the selected source frame. No output was published.");
   }
}
