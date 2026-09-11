import type { Clip } from "../../../shared/types";

/** Preserve assigned colors unless a new neighbor or an old session creates a collision. */
export function distinctClipColors(clips: Clip[]): Clip[] {
   const used = new Set<number>();
   let nextColor = Math.max(-1, ...clips.map((clip) => clip.color)) + 1;
   return clips.reduce<Clip[]>((result, clip, index) => {
      const left = result.at(-1)?.color;
      let color = clip.color;
      if (used.has(color) || (left !== undefined && left % 6 === color % 6)) {
         const right = clips[index + 1]?.color;
         while ((left !== undefined && nextColor % 6 === left % 6) || (right !== undefined && nextColor % 6 === right % 6)) nextColor++;
         color = nextColor++;
      }
      used.add(color);
      result.push(color === clip.color ? clip : { ...clip, color });
      return result;
   }, []);
}

/** Subtle hue variations extend the theme palette without changing a clip on selection. */
export function clipColor(color: number): string {
   const base = `var(--clip-${color % 6})`;
   const cycle = Math.floor(color / 6);
   if (cycle === 0) return base;
   const shift = ((cycle * 137.508) % 24) - 12;
   return `oklch(from ${base} l c calc(h + ${shift.toFixed(3)}))`;
}
