import type { Clip } from "../../../shared/types";
import type { EditDocument } from "./model";
import { minClipLength, timeEpsilon } from "./model";

export function adjacentBoundary(clips: Clip[], time: number, direction: -1 | 1): number | null {
   const points = [...new Set(clips.flatMap((clip) => [clip.start, clip.end]))].sort((a, b) => a - b);
   return direction === 1
      ? (points.find((point) => point > time + timeEpsilon) ?? null)
      : (points.filter((point) => point < time - timeEpsilon).at(-1) ?? null);
}
/** Extra range a boundary is allowed to take, e.g. a clip's minimum-length floor. */
export interface SnapBounds {
   low?: number;
   high?: number;
}
export function snapBoundary(
   document: EditDocument,
   id: string,
   side: "start" | "end",
   value: number,
   keys: number[],
   duration: number,
   bounds?: SnapBounds
): number {
   const index = document.clips.findIndex((clip) => clip.id === id);
   const clip = document.clips[index]!;
   const min = Math.max(side === "start" ? (document.clips[index - 1]?.end ?? 0) : clip.start + timeEpsilon, bounds?.low ?? -Infinity);
   const max = Math.min(side === "end" ? (document.clips[index + 1]?.start ?? duration) : clip.end - timeEpsilon, bounds?.high ?? Infinity);
   const best = [0, ...keys, duration]
      .filter((point) => point >= min && point <= max)
      .reduce((best, point) => (Math.abs(point - value) < Math.abs(best - value) ? point : best), Infinity);
   return Number.isFinite(best) ? best : clip[side];
}
/** Nearest keyframe from a boundary in one direction, treating the timeline ends as keyframes. */
export function adjacentKeyframe(value: number, direction: -1 | 1, keys: number[], duration: number, bounds?: SnapBounds): number {
   return direction === 1
      ? ([...keys, duration].find((point) => point > value + timeEpsilon && point <= (bounds?.high ?? Infinity)) ?? value)
      : ([0, ...keys].filter((point) => point < value - timeEpsilon && point >= (bounds?.low ?? -Infinity)).at(-1) ?? value);
}

/** Longest floor a clip must keep at this zoom without expanding already shorter clips. */
export function clipFloor(document: EditDocument, id: string, viewLength: number, frameStep: number): number {
   const clip = document.clips.find((item) => item.id === id);
   if (!clip) return 0;
   return Math.min(clip.end - clip.start, minClipLength(viewLength, frameStep));
}

export interface BoundaryOptions {
   duration: number;
   /** Current timeline view length in seconds; the floor scales with it so zooming in restores precision. */
   viewLength: number;
   frameStep: number;
   snapping: boolean;
   keyframes?: number[];
}

/**
 * Legal time for one boundary edit, shared by pointer drags, trim commands, and typed times:
 * keyframe snapping when enabled, then the zoom floor that keeps handles usable. Callers hand
 * the result to trimClip, which applies the neighbor limits. Keyboard steps pass a
 * pre-snapped target with snapping disabled; every other path snaps to the nearest key.
 */
export function resolveBoundary(document: EditDocument, id: string, side: "start" | "end", target: number, options: BoundaryOptions): number {
   const clip = document.clips.find((item) => item.id === id);
   if (!clip) return target;
   const floor = clipFloor(document, id, options.viewLength, options.frameStep);
   const bounded = side === "start" ? Math.min(target, clip.end - floor) : Math.max(target, clip.start + floor);
   if (!options.snapping) return bounded;
   return snapBoundary(
      document,
      id,
      side,
      bounded,
      options.keyframes ?? [],
      options.duration,
      side === "start" ? { high: clip.end - floor } : { low: clip.start + floor }
   );
}
