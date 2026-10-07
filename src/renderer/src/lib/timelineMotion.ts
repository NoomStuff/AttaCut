import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { constrainViewStart } from "../editor/timelineView";

export interface TimelineView {
   start: number;
   length: number;
}

/** One interpolation for both coordinates, including playback updates during a zoom. */
export class TimelineMotion {
   value: TimelineView;
   private target: TimelineView;
   private run: { from: TimelineView; start: number; zoom: boolean } | null = null;
   constructor(view: TimelineView) {
      this.value = this.target = view;
   }
   get active(): boolean {
      return this.run !== null;
   }
   retarget(view: TimelineView, now: number, playing: boolean, immediate = false): void {
      if (immediate) {
         this.value = this.target = view;
         this.run = null;
         return;
      }
      if (view.start === this.target.start && view.length === this.target.length) return;
      const zoom = view.length !== this.target.length;
      this.target = view;
      if (playing && !zoom && !this.run?.zoom) {
         this.value = view;
         this.run = null;
      } else if (zoom || !this.run?.zoom) {
         this.run = { from: this.value, start: now, zoom };
      }
      // A playback pan changes the destination during a zoom, but never restarts
      // either coordinate or switches the position to snapping partway through.
   }
   frame(now: number, constrain: (view: TimelineView) => TimelineView): TimelineView {
      if (this.run) {
         const progress = Math.min(1, Math.max(0, (now - this.run.start) / 240));
         const eased = 1 - (1 - progress) ** 3;
         this.value = {
            start: this.run.from.start + (this.target.start - this.run.from.start) * eased,
            length: this.run.from.length + (this.target.length - this.run.from.length) * eased,
         };
         if (progress === 1) this.run = null;
      }
      this.value = constrain(this.value);
      return this.value;
   }
}

export function useTimelineMotion(
   target: TimelineView,
   options: { duration: number; playing: boolean; time: () => number; pointer: boolean; immediate: () => boolean }
): TimelineView {
   const [motion] = useState(() => new TimelineMotion(target));
   const [, render] = useReducer((count: number) => count + 1, 0);
   const frame = useRef(0);
   const latest = useRef(options);
   latest.current = options;
   const constrain = (view: TimelineView): TimelineView => {
      const current = latest.current;
      return {
         ...view,
         start: constrainViewStart(view.start, view.length, current.duration, current.playing && !current.pointer ? current.time() : undefined),
      };
   };
   useLayoutEffect(() => {
      const previous = motion.value;
      motion.retarget(target, performance.now(), options.playing, options.immediate() || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      motion.value = constrain(motion.value);
      if (previous.start !== motion.value.start || previous.length !== motion.value.length) render();
      if (!motion.active || frame.current) return;
      const tick = (now: number) => {
         frame.current = 0;
         motion.frame(now, constrain);
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
   return constrain(motion.value);
}
