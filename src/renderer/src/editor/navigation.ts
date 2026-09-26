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
/** Keys are sorted; binary search keeps snapping instant on all-intra multi-hour recordings. */
function firstAfter(keys: number[], value: number): number | null {
   let low = 0;
   let high = keys.length;
   while (low < high) {
      const mid = (low + high) >> 1;
      if (keys[mid]! > value) high = mid;
      else low = mid + 1;
   }
   return low < keys.length ? keys[low]! : null;
}
function lastBefore(keys: number[], value: number): number | null {
   let low = 0;
   let high = keys.length;
   while (low < high) {
      const mid = (low + high) >> 1;
      if (keys[mid]! < value) low = mid + 1;
      else high = mid;
   }
   return low > 0 ? keys[low - 1]! : null;
}
/** Navigate source keyframes without scanning every entry in a long recording. */
export function neighboringKeyframe(value: number, direction: -1 | 1, keys: number[]): number | null {
   return direction < 0 ? lastBefore(keys, value - 0.0005) : firstAfter(keys, value + 0.0005);
}
function nearestKey(keys: number[], value: number, min: number, max: number): number | null {
   let lo = 0;
   let hi = keys.length;
   while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid]! < min) lo = mid + 1;
      else hi = mid;
   }
   let l2 = lo;
   let h2 = keys.length;
   while (l2 < h2) {
      const mid = (l2 + h2) >> 1;
      if (keys[mid]! <= max) l2 = mid + 1;
      else h2 = mid;
   }
   const last = l2 - 1;
   if (lo > last) return null;
   const first = keys[lo]!;
   const final = keys[last]!;
   // The target can sit outside the in-range span, where the nearest key is an endpoint.
   if (value <= first) return first;
   if (value >= final) return final;
   let low = lo;
   let high = last + 1;
   while (low < high) {
      const mid = (low + high) >> 1;
      if (keys[mid]! < value) low = mid + 1;
      else high = mid;
   }
   let best = keys[low]!;
   const before = keys[low - 1]!;
   if (Math.abs(before - value) < Math.abs(best - value)) best = before;
   return best;
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
   const inRange = (point: number) => point >= min && point <= max;
   let best: number | null = inRange(0) ? 0 : null;
   const key = nearestKey(keys, value, min, max);
   if (key !== null && (best === null || Math.abs(key - value) < Math.abs(best - value))) best = key;
   if (inRange(duration) && (best === null || Math.abs(duration - value) < Math.abs(best - value))) best = duration;
   return best !== null ? best : clip[side];
}
/** Nearest keyframe from a boundary in one direction, treating the timeline ends as keyframes. */
export function adjacentKeyframe(value: number, direction: -1 | 1, keys: number[], duration: number, bounds?: SnapBounds): number {
   if (direction === 1) {
      const high = bounds?.high ?? Infinity;
      const key = firstAfter(keys, value + timeEpsilon);
      if (key !== null && key <= high) return key;
      return duration > value + timeEpsilon && duration <= high ? duration : value;
   }
   const low = bounds?.low ?? -Infinity;
   const key = lastBefore(keys, value - timeEpsilon);
   if (key !== null && key >= low) return key;
   return 0 < value - timeEpsilon && 0 >= low ? 0 : value;
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

export interface SplitOptions {
   snapping: boolean;
   keyframes: number[];
}

/**
 * Where a split at `time` should land: the playhead itself, or when snapping is on the
 * nearest keyframe inside the clip. Infinity when no keyframe qualifies, which disables the
 * split rather than moving it to an unintended boundary.
 */
export function splitTargetAt(document: EditDocument, id: string, time: number, options: SplitOptions): number {
   if (!options.snapping) return time;
   const clip = document.clips.find((item) => item.id === id);
   if (!clip) return time;
   return nearestKey(options.keyframes, time, clip.start, clip.end) ?? Infinity;
}

export interface StepOptions {
   duration: number;
   viewLength: number;
   frameStep: number;
   snapping: boolean;
   keyframes: number[];
   /** Distance in seconds for a non-snapped step, e.g. one frame, or a full second with Shift. */
   step?: number;
}

/** One keyboard step of a boundary from its current position, respecting the same legality floor as drags. */
export function stepBoundary(document: EditDocument, id: string, side: "start" | "end", direction: -1 | 1, options: StepOptions): number {
   const clip = document.clips.find((item) => item.id === id);
   if (!clip) return 0;
   const floor = clipFloor(document, id, options.viewLength, options.frameStep);
   const target = options.snapping
      ? adjacentKeyframe(
           clip[side],
           direction,
           options.keyframes,
           options.duration,
           side === "start" ? { high: clip.end - floor } : { low: clip.start + floor }
        )
      : clip[side] + direction * (options.step ?? options.frameStep);
   return resolveBoundary(document, id, side, target, {
      duration: options.duration,
      viewLength: options.viewLength,
      frameStep: options.frameStep,
      snapping: false,
   });
}
