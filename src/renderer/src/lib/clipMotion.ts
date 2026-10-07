import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { Clip } from "../../../shared/types";

/** Clip edges and waveform bands consume the same displayed source boundaries. */
export class ClipMotion {
   value: Clip[];
   private target: Clip[];
   private run: { from: Clip[]; start: number } | null = null;
   constructor(clips: Clip[]) {
      this.value = this.target = clips;
   }
   get active(): boolean {
      return this.run !== null;
   }
   retarget(clips: Clip[], now: number, animate: boolean): void {
      if (clips === this.target) return;
      const sameIds = clips.length === this.value.length && clips.every((clip, index) => clip.id === this.value[index]!.id);
      const moved = sameIds && clips.some((clip, index) => clip.start !== this.value[index]!.start || clip.end !== this.value[index]!.end);
      this.target = clips;
      if (animate && moved) this.run = { from: this.value, start: now };
      else {
         this.value = clips;
         this.run = null;
      }
   }
   frame(now: number): Clip[] {
      if (!this.run) return this.value;
      const progress = Math.min(1, Math.max(0, (now - this.run.start) / 170));
      const eased = 1 - (1 - progress) ** 3;
      this.value = this.target.map((clip, index) => {
         const from = this.run!.from[index]!;
         return { ...clip, start: from.start + (clip.start - from.start) * eased, end: from.end + (clip.end - from.end) * eased };
      });
      if (progress === 1) {
         this.value = this.target;
         this.run = null;
      }
      return this.value;
   }
}

export function useClipMotion(clips: Clip[], animate: boolean): Clip[] {
   const [motion] = useState(() => new ClipMotion(clips));
   const [, render] = useReducer((count: number) => count + 1, 0);
   const frame = useRef(0);
   useLayoutEffect(() => {
      const previous = motion.value;
      motion.retarget(clips, performance.now(), animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (previous !== motion.value) render();
      if (!motion.active || frame.current) return;
      const tick = (now: number) => {
         frame.current = 0;
         motion.frame(now);
         if (motion.active) frame.current = requestAnimationFrame(tick);
         render();
      };
      frame.current = requestAnimationFrame(tick);
   });
   useEffect(
      () => () => {
         cancelAnimationFrame(frame.current);
         frame.current = 0;
      },
      []
   );
   return motion.value;
}
