import type { Clip } from "../../../shared/types";
import { clipColorCount } from "../../../shared/defaults";

/** Continue the sequence, skipping base colours used by either new neighbour. */
export function nextClipColor(clips: Clip[], left?: Clip, right?: Clip): number {
   let color = Math.max(-1, ...clips.map((clip) => clip.color)) + 1;
   const blocked = new Set([left, right].filter((clip) => clip !== undefined).map((clip) => clip.color % clipColorCount));
   while (blocked.has(color % clipColorCount)) color++;
   return color;
}

/** Each pass through the base palette shifts its hues instead of repeating it exactly. */
export function clipColor(color: number): string {
   const baseIndex = color % clipColorCount;
   const base = `var(--clip-sequence-${baseIndex}, var(--clip-${baseIndex}))`;
   const cycle = Math.floor(color / clipColorCount);
   if (cycle === 0) return base;
   return `oklch(from ${base} l c calc(h + ${cycle * 7}))`;
}
