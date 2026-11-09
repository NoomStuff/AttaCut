import type { Clip } from "../../../shared/types";
import { timeEpsilon } from "./model";

/** YouTube reads whole seconds: `m:ss` under an hour, `h:mm:ss` from there. */
export function youtubeTime(seconds: number): string {
   const total = Math.max(0, Math.floor(seconds + 0.000001));
   const hours = Math.floor(total / 3600);
   const minutes = Math.floor((total % 3600) / 60);
   const rest = String(total % 60).padStart(2, "0");
   return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export interface YoutubeChapters {
   text: string;
   /** True when the times are offsets in the combined export rather than source times. */
   combined: boolean;
   /** YouTube ignores chapter lists with fewer than three entries or one shorter than ten seconds. */
   usable: boolean;
}

/**
 * One `0:00 Clip 1` line per clip. YouTube requires the first chapter at 0:00, so source times
 * only work when the first clip starts there; otherwise each line is the clip's offset in a
 * combined export of all clips.
 */
export function youtubeChapters(clips: readonly Clip[], duration: number): YoutubeChapters {
   const combined = (clips[0]?.start ?? 0) > timeEpsilon;
   const starts: number[] = [];
   const lengths: number[] = [];
   let offset = 0;
   for (const [index, clip] of clips.entries()) {
      if (combined) {
         starts.push(offset);
         lengths.push(clip.end - clip.start);
         offset += clip.end - clip.start;
      } else {
         starts.push(clip.start);
         // On the source, a chapter runs until the next clip starts.
         lengths.push((clips[index + 1]?.start ?? duration) - clip.start);
      }
   }
   const seconds = starts.map((start) => Math.floor(start + 0.000001));
   return {
      text: starts.map((start, index) => `${youtubeTime(start)} Clip ${index + 1}\n`).join(""),
      combined,
      usable:
         clips.length >= 3 && lengths.every((length) => length >= 10 - 0.000001) && seconds.every((time, index) => index === 0 || time > seconds[index - 1]!),
   };
}

/** Source times in seconds with millisecond precision. */
export function clipTimesCsv(clips: readonly Clip[]): string {
   // Round each boundary once so the duration column always equals end minus start.
   const millis = (value: number) => Math.round(value * 1000);
   const seconds = (value: number) => (value / 1000).toFixed(3);
   return [
      "start,end,duration\n",
      ...clips.map((clip) => {
         const start = millis(clip.start);
         const end = millis(clip.end);
         return `${seconds(start)},${seconds(end)},${seconds(end - start)}\n`;
      }),
   ].join("");
}
