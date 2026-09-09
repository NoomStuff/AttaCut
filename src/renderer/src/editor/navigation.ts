import type { Clip } from "../../../shared/types";
import type { EditDocument } from "./model";
import { timeEpsilon } from "./model";

export function adjacentBoundary(clips: Clip[], time: number, direction: -1 | 1): number | null {
   const points = [...new Set(clips.flatMap((clip) => [clip.start, clip.end]))].sort((a, b) => a - b);
   return direction === 1
      ? (points.find((point) => point > time + timeEpsilon) ?? null)
      : (points.filter((point) => point < time - timeEpsilon).at(-1) ?? null);
}
export function snapBoundary(document: EditDocument, id: string, side: "start" | "end", value: number, keys: number[], duration: number): number {
   const index = document.clips.findIndex((clip) => clip.id === id);
   const clip = document.clips[index]!;
   const min = side === "start" ? (document.clips[index - 1]?.end ?? 0) : clip.start + timeEpsilon;
   const max = side === "end" ? (document.clips[index + 1]?.start ?? duration) : clip.end - timeEpsilon;
   const best = [0, ...keys, duration]
      .filter((point) => point >= min && point <= max)
      .reduce((best, point) => (Math.abs(point - value) < Math.abs(best - value) ? point : best), Infinity);
   return Number.isFinite(best) ? best : clip[side];
}
