import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";
import { probeSource } from "./probe.ts";

/** Check the promised stream inventory before making an output visible. */
export async function verifyOutputStructure(
   source: ProbedSource,
   output: string,
   audioTracks: number[],
   duration: number,
   signal?: AbortSignal,
   start = 0,
   ignoreTypes: readonly string[] = []
): Promise<void> {
   const actual = await probeSource(output, signal);
   const expected = source.streams.filter((stream) => (stream.type !== "audio" || audioTracks.includes(stream.index)) && !ignoreTypes.includes(stream.type));
   for (const type of new Set([...expected, ...actual.streams].map((stream) => stream.type))) {
      const before = expected.filter((stream) => stream.type === type);
      const after = actual.streams.filter((stream) => stream.type === type);
      if (before.length !== after.length) throw new Error(`The export did not preserve the expected ${type} tracks. No output was published.`);
      for (const [index, stream] of before.entries()) {
         const result = after[index]!;
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
         if ((type === "audio" || type === "subtitle") && stream.language && stream.language !== "und" && stream.language !== result.language)
            throw new Error("The export changed track language metadata. No output was published.");
         if (type === "audio" && stream.startTime !== undefined && result.startTime !== undefined) {
            const expectedStart = Math.max(0, stream.startTime - source.startOffset - start);
            const actualStart = Math.max(0, result.startTime - actual.startOffset);
            if (expectedStart < duration && Math.abs(expectedStart - actualStart) > 0.15)
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
   if (Math.abs(actual.duration - duration) > 0.25) throw new Error("The exported duration does not match the selected clips. No output was published.");
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
         "0:v:0",
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
      const [original, copy] = await Promise.all([frameHash(source.path, time, source.startOffset, signal), frameHash(output, time - start, 0, signal)]);
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
            `[0:v:0]trim=start=${Math.max(0, time + source.startOffset - 0.0011)},setpts=PTS-STARTPTS[a];` +
               `[1:v:0]trim=start=${Math.max(0, outputTime - 0.0011)},setpts=PTS-STARTPTS[b];` +
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
