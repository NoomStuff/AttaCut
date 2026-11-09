import { clipColorCount } from "../../../shared/defaults";
import type { Clip } from "../../../shared/types";

/**
 * The parts between and around the clips, for exporting everything except the clips.
 * Gaps shorter than `minimum` (about one frame) are slivers between touching clips, not content.
 */
export function gapsBetween(clips: readonly Clip[], duration: number, minimum: number): Clip[] {
   const sorted = [...clips].sort((a, b) => a.start - b.start);
   const gaps: Clip[] = [];
   let cursor = 0;
   let previous: Clip | null = null;
   for (const clip of [...sorted, null]) {
      const end = clip ? clip.start : duration;
      if (end - cursor >= minimum)
         gaps.push({
            id: `gap:${previous?.id ?? "start"}:${clip?.id ?? "end"}`,
            start: cursor,
            end,
            color: gaps.length % clipColorCount,
         });
      if (clip) {
         cursor = Math.max(cursor, clip.end);
         previous = clip;
      }
   }
   return gaps;
}

function merged(ranges: readonly { start: number; end: number }[]): { start: number; end: number }[] {
   const result: { start: number; end: number }[] = [];
   for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
      const last = result.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else result.push({ ...range });
   }
   return result;
}
function covered(ranges: readonly { start: number; end: number }[]): number {
   return ranges.reduce((sum, range) => sum + range.end - range.start, 0);
}
function overlap(a: readonly { start: number; end: number }[], b: readonly { start: number; end: number }[]): number {
   let total = 0;
   for (const x of a) for (const y of b) total += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
   return total;
}

/** Seconds the exported ranges add to and drop from the selected ones, after cuts move to keyframes. */
export function coverageChange(
   selected: readonly { start: number; end: number }[],
   exported: readonly { start: number; end: number }[]
): { added: number; dropped: number } {
   const before = merged(selected);
   const after = merged(exported);
   const shared = overlap(before, after);
   return { added: Math.max(0, covered(after) - shared), dropped: Math.max(0, covered(before) - shared) };
}
