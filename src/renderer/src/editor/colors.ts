import type { Clip } from "../../../shared/types";
import { clipColorCount } from "../../../shared/defaults";

/** Reuse the first free palette slot, skipping either neighbour's base colour. */
export function nextClipColor(clips: Clip[], left?: Clip, right?: Clip): number {
   const used = new Set(clips.map((clip) => clip.color));
   let color = 0;
   const blocked = new Set([left, right].filter((clip) => clip !== undefined).map((clip) => clip.color % clipColorCount));
   while (used.has(color) || blocked.has(color % clipColorCount)) color++;
   return color;
}

/** Each pass through the base palette shifts its hues enough to stay distinguishable from the pass before. */
export function clipColor(color: number): string {
   const baseIndex = color % clipColorCount;
   const base = `var(--clip-sequence-${baseIndex}, var(--clip-${baseIndex}))`;
   const cycle = Math.floor(color / clipColorCount);
   if (cycle === 0) return base;
   return `oklch(from ${base} l c calc(h + ${cycle * 20}))`;
}
