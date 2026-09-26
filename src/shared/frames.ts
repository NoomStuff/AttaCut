import { lowerBound } from "./sorted";

/** Boundaries are source presentation timestamps; starts are inclusive, ends exclusive. */
export function resolveFrameTime(points: readonly number[], time: number, duration: number, direction: -1 | 0 | 1 = 0): number {
   if (!points.length) return Math.max(0, Math.min(time, duration));
   const low = lowerBound(points, time);
   const after = low < points.length ? points[low]! : null;
   const before = low > 0 ? points[low - 1]! : null;
   // The <= comparison keeps the first point on ties, matching a linear scan of sorted points.
   const nearest = after === null ? before! : before === null ? after : Math.abs(before - time) <= Math.abs(after - time) ? before : after;
   const current = Math.abs(time - duration) < 0.0001 ? duration : nearest;
   if (direction < 0) {
      const low = lowerBound(points, current - 0.0001);
      return low > 0 ? points[low - 1]! : points[0]!;
   }
   if (direction > 0) {
      const low = lowerBound(points, current + 0.0001, true);
      return low < points.length ? points[low]! : duration;
   }
   if (time <= 0) return Math.max(0, points[0]!);
   if (Math.abs(time - duration) < 0.0001) return duration;
   return nearest;
}
