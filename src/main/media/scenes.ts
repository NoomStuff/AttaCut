import { primaryVideo, type DetectedRange } from "../../shared/media";
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

/** Ranges come back in source time, already merged and limited to the source extent. */
const rangeLimit = 10_000;
function pushRange(ranges: DetectedRange[], start: number, end: number, duration: number): void {
   const from = Math.max(0, start);
   const to = Math.min(end, duration);
   if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
   const last = ranges.at(-1);
   if (last && from <= last.end) {
      last.end = Math.max(last.end, to);
      return;
   }
   if (ranges.length >= rangeLimit) throw new Error("Too many parts found. Raise the minimum length and scan again.");
   ranges.push({ start: from, end: to });
}

/**
 * Silent stretches of one audio track, at least `minimum` seconds long. Every channel must be
 * quieter than `noise` dB. The filter prints times with six significant digits, so its
 * timestamps start at the source origin to keep them as precise as possible.
 */
export async function detectSilence(source: ProbedSource, audioIndex: number, noise: number, minimum: number, signal: AbortSignal): Promise<DetectedRange[]> {
   const stream = source.streams.find((item) => item.index === audioIndex && item.type === "audio");
   if (!stream) throw new Error("This video has no audio to scan.");
   const ranges: DetectedRange[] = [];
   let start: number | null = null;
   const origin = Math.round(source.startOffset * 1_000_000);
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
         `0:${audioIndex}`,
         "-vn",
         "-sn",
         "-dn",
         "-filter_threads",
         "1",
         "-af",
         `asettb=AVTB,asetpts=PTS-(${origin}),silencedetect=n=${noise}dB:d=${minimum},ametadata=mode=print:file='pipe\\:1'`,
         "-f",
         "null",
         "-",
      ],
      {
         signal,
         priority: "background",
         belowNormal: true,
         onLines: (line) => {
            const match = /^lavfi\.silence_(start|end)=(-?[\d.]+)/.exec(line.trim());
            if (!match) return;
            const time = Number(match[2]);
            if (match[1] === "start") start ??= time;
            else if (start !== null) {
               pushRange(ranges, start, time, source.duration);
               start = null;
            }
         },
      }
   );
   signal.throwIfAborted();
   // Silence that runs to the end of the file never reports an end.
   if (start !== null) pushRange(ranges, start, source.duration, source.duration);
   return ranges;
}

/** Black stretches of the primary video, at least `minimum` seconds long, on source frame times. */
export async function detectBlack(source: ProbedSource, minimum: number, signal: AbortSignal): Promise<DetectedRange[]> {
   const video = primaryVideo(source);
   if (!video) throw new Error("This source has no video to scan.");
   const ranges: DetectedRange[] = [];
   let frame: number | null = null;
   let first = false;
   let start: number | null = null;
   const close = (end: number) => {
      if (start !== null && end - start >= minimum - 0.000001) pushRange(ranges, start, end, source.duration);
      start = null;
   };
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
         `settb=AVTB,scale=w='min(320,iw)':h='min(320,ih)':force_original_aspect_ratio=decrease,blackdetect=d=0,metadata=mode=print:file='pipe\\:1'`,
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
            // The frame line carries integer microseconds; the metadata text is rounded.
            const header = /^frame:\s*(\d+)\s+pts:\s*(-?\d+)/.exec(line.trim());
            if (header) {
               first = header[1] === "0";
               frame = Number(header[2]) / 1_000_000 - source.startOffset;
               return;
            }
            const key = /^lavfi\.black_(start|end)=/.exec(line.trim());
            if (!key || frame === null) return;
            // Black from the first picture covers everything before it too.
            if (key[1] === "start") start ??= first ? 0 : frame;
            else close(frame);
         },
      }
   );
   signal.throwIfAborted();
   close(source.duration);
   return ranges;
}
