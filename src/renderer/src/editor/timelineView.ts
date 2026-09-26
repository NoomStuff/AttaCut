import { lowerBound } from "../../../shared/sorted";
import { clamp } from "../../../shared/time";

const zoomLevels = Array.from({ length: 10 }, (_, decade) => [100, 125, 150, 200, 250, 300, 400, 500, 600, 800].map((step) => step * 10 ** decade)).flat();

export function zoomLength(length: number, duration: number, direction: number): number {
   if (direction === 0) return duration;
   const percent = (100 * duration) / length;
   const next = direction > 0 ? zoomLevels.find((level) => level > percent + 0.001) : zoomLevels.findLast((level) => level < percent - 0.001);
   return clamp((100 * duration) / (next ?? (direction > 0 ? zoomLevels.at(-1)! : 100)), Math.min(0.5, duration), duration);
}

export function visibleKeyframes(points: readonly number[], start: number, length: number, pxPerSecond: number): { ticks: number[]; opacity: number } {
   if (length <= 0) return { ticks: [], opacity: 1 };
   const first = lowerBound(points, start);
   const end = lowerBound(points, start + length, true);
   const count = end - first;
   const gap = count > 1 && pxPerSecond > 0 ? ((points[end - 1]! - points[first]!) / (count - 1)) * pxPerSecond : Infinity;
   const ticks: number[] = [];
   // Dense intraframe recordings can have hundreds of thousands of keyframes; snapping keeps
   // every point, drawing picks at most one tick per view/500, and opacity reports how
   // tightly the points pack the drawn view so the ticks can fade out when too dense.
   // Jump between drawable ticks instead of scanning every frame of an all-intra recording.
   for (let index = first; index < end;) {
      const point = points[index]!;
      ticks.push(point);
      index = Math.max(index + 1, lowerBound(points, point + length / 500));
   }
   return { ticks, opacity: clamp((gap - 8) / 8, 0, 1) };
}
