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
