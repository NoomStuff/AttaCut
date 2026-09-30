import { withTemporaryOutput } from "./transaction";
import { primaryVideo } from "../../shared/types";
import { publishOutput } from "./publish.ts";
import { join, resolve } from "node:path";
import type { FrameRequest } from "../../shared/types.ts";
import { assertSourceUnchanged, packetsAround, sourceFrames } from "./probe.ts";
import type { ProbedSource } from "./probe.ts";
import { ffmpegBase, runMedia } from "./process.ts";
import { sanitizeName } from "../../shared/filename";
import { isHdrTransfer, tonemapToBt709 } from "./formats.ts";
import { resolveFrameTime } from "../../shared/frames.ts";

export async function exportFrame(source: ProbedSource, request: FrameRequest, signal?: AbortSignal): Promise<string> {
   signal?.throwIfAborted();
   await assertSourceUnchanged(source);
   const directory = resolve(request.directory);
   return withTemporaryOutput(directory, ".attacut-frame-", async (temporary) => {
      const path = join(temporary, `frame.${request.format}`);
      const frames = await sourceFrames(source, signal);
      const points = frames ?? (await packetsAround(source, Math.min(request.time, source.duration), signal, "seek")).map((point) => point.time);
      if (!points.length) throw new Error("No frame is available at this time.");
      const time = resolveFrameTime(points, Math.min(request.time, points.at(-1)!), source.duration);
      const video = primaryVideo(source)!;
      const hdr = isHdrTransfer(video.colorTransfer);
      const filter = `trim=start=${time + source.startOffset - 0.0001},setpts=PTS-STARTPTS` + (hdr ? `,${tonemapToBt709("rgb24")}` : "");
      await runMedia(
         "ffmpeg",
         [
            ...ffmpegBase,
            "-copyts",
            ...(time > 5 ? ["-ss", String(time - 5)] : []),
            "-i",
            source.path,
            "-map",
            `0:${video.index}`,
            "-vf",
            filter,
            "-frames:v",
            "1",
            ...(request.format === "jpg" ? ["-q:v", String(Math.round(2 + ((100 - request.quality) * 29) / 99))] : ["-compression_level", "6"]),
            "-update",
            "1",
            path,
         ],
         { signal }
      );
      signal?.throwIfAborted();
      await assertSourceUnchanged(source);
      const stem = sanitizeName(request.name.replace(/\.(png|jpe?g)$/i, ""));
      for (let suffix = 1; ; suffix++) {
         const destination = join(directory, `${stem}${suffix === 1 ? "" : ` (${suffix})`}.${request.format}`);
         try {
            await publishOutput(path, destination);
            return destination;
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
         }
      }
   });
}
