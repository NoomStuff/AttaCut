import { useSyncExternalStore } from "react";
export class PlaybackClock {
   private time = 0;
   private glide = false;
   private listeners = new Set<() => void>();
   get = (): number => this.time;
   /** A glide set asks the timeline playhead to tween into this time even when the move is
       shorter than its snap threshold; the next differing set clears it. */
   set = (time: number, options: { glide?: boolean } = {}): void => {
      if (time !== this.time) {
         this.time = time;
         this.glide = !!options.glide;
         for (const listener of this.listeners) listener();
      }
   };
   consumeGlide = (): boolean => {
      const glide = this.glide;
      this.glide = false;
      return glide;
   };
   subscribe = (callback: () => void): (() => void) => {
      this.listeners.add(callback);
      return () => {
         this.listeners.delete(callback);
      };
   };
}
export function useClock(clock: PlaybackClock): number {
   return useSyncExternalStore(clock.subscribe, clock.get);
}
