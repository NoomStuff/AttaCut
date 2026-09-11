import type { Clip } from "../../../shared/types";

/** Classify edits by their kept ranges, including undo/redo of splits and merges. */
export function clipChanges(previous: Clip[], next: Clip[]) {
   const entering: string[] = [];
   const exiting: { clip: Clip; index: number }[] = [];
   const flashes = new Map<string, ("start" | "end")[]>();
   const seams: { time: number; color: number }[] = [];
   const contains = (outer: Clip, inner: Clip) => outer.start <= inner.start && outer.end >= inner.end;
   for (const clip of next) {
      if (previous.some((old) => old.id === clip.id)) continue;
      const parent = previous.find((old) => contains(old, clip));
      if (!parent) entering.push(clip.id);
      else {
         for (const part of next.filter((item) => contains(parent, item))) {
            flashes.set(
               part.id,
               (["start", "end"] as const).filter((side) => part[side] > parent.start && part[side] < parent.end)
            );
         }
      }
   }
   previous.forEach((clip, index) => {
      if (next.some((item) => item.id === clip.id)) return;
      const merged = next.find((item) => contains(item, clip));
      if (merged) {
         flashes.set(merged.id, []);
         for (const time of [clip.start, clip.end]) {
            if (time > merged.start && time < merged.end && !seams.some((seam) => seam.time === time)) seams.push({ time, color: clip.color });
         }
      } else exiting.push({ clip, index });
   });
   return { entering, exiting, flashes, seams };
}
