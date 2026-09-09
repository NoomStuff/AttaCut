import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";

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
