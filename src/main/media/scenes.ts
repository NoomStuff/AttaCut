import { primaryVideo } from "../../shared/media";
import type { ProbedSource } from "./probe";
import { ffmpegBase, runMedia } from "./process";

/** Decode every frame, but compare small pictures. Timestamps stay on the source grid. */
export async function detectSceneCuts(source: ProbedSource, threshold: number, signal: AbortSignal): Promise<number[]> {
   const video = primaryVideo(source);
   if (!video) throw new Error("This source has no video to scan.");
   const cuts: number[] = [];
   await runMedia(
      "ffmpeg",
      [
         ...ffmpegBase,
         "-copyts",
         "-threads",
         "2",
         "-i",
         source.path,
         "-map",
         `0:${video.index}`,
         "-an",
         "-sn",
         "-dn",
         "-filter_threads",
         "1",
         "-vf",
         `settb=AVTB,scale=w='min(320,iw)':h='min(320,ih)':force_original_aspect_ratio=decrease,scdet=threshold=${threshold}:sc_pass=1,metadata=mode=print:file='pipe\\:1'`,
         "-fps_mode",
         "passthrough",
         "-f",
         "null",
         "-",
      ],
      {
         signal,
         priority: "background",
         belowNormal: true,
         onLines: (line) => {
            // Integer microseconds avoid the rounded pts_time/scd.time text, especially in long recordings.
            const match = /\bpts:\s*(-?\d+)/.exec(line);
            if (!match) return;
            const time = Number(match[1]) / 1_000_000 - source.startOffset;
            if (!Number.isFinite(time) || time <= 0 || time >= source.duration || time <= (cuts.at(-1) ?? -Infinity)) return;
            if (cuts.length >= 10_000) throw new Error("Too many scene cuts. Lower the sensitivity and scan again.");
            cuts.push(time);
         },
      }
   );
   signal.throwIfAborted();
   return cuts;
}
