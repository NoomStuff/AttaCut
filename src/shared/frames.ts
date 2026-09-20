/** Boundaries are source presentation timestamps; starts are inclusive, ends exclusive. */
export function resolveFrameTime(points: readonly number[], time: number, duration: number, direction: -1 | 0 | 1 = 0): number {
   if (!points.length) return Math.max(0, Math.min(time, duration));
   const nearest = points.reduce((best, point) => (Math.abs(point - time) < Math.abs(best - time) ? point : best));
   const current = Math.abs(time - duration) < 0.0001 ? duration : nearest;
   if (direction < 0) return points.findLast((point) => point < current - 0.0001) ?? points[0]!;
   if (direction > 0) return points.find((point) => point > current + 0.0001) ?? duration;
   if (time <= 0) return Math.max(0, points[0]!);
   if (Math.abs(time - duration) < 0.0001) return duration;
   return nearest;
}
