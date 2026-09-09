import type { Clip } from "../../../shared/types";

/** Source time to play next, or null once all kept ranges have ended. */
export function nextKeptTime(clips: readonly Clip[], time: number): number | null {
   for (const clip of clips) {
      // Media clocks can round a requested start a fraction of a microsecond down.
      if (time >= clip.start - 0.000001 && time < clip.end) return time;
      if (time < clip.start) return clip.start;
   }
   return null;
}
