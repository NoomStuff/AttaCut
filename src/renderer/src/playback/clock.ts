import { useSyncExternalStore } from "react";
export class PlaybackClock {
   private time = 0;
   private glide = false;
   private resolved: { requested: number; frame: number } | null = null;
   private displayed: { url: string; frame: number } | null = null;
   private listeners = new Set<() => void>();
   get = (): number => this.time;
   getFrame = (): number => this.getResolved() ?? this.time;
   getResolved = (): number | null => (this.resolved?.requested === this.time ? this.resolved.frame : null);
   resolveFrame(requested: number, frame: number): void {
      const previous = this.getResolved();
      this.resolved = { requested, frame };
      if (previous !== this.getResolved()) for (const listener of this.listeners) listener();
   }
   getDisplayed(url: string): number | null {
      return this.displayed?.url === url ? this.displayed.frame : null;
   }
   displayFrame(url: string, frame: number): void {
      this.displayed = { url, frame };
   }
   clearFrames(): void {
      this.resolved = null;
      this.displayed = null;
   }
   /** A glide set asks the timeline playhead to tween into this time even when the move is
       shorter than its snap threshold; the next differing set clears it. */
   set = (time: number, options: { glide?: boolean } = {}): void => {
      if (time !== this.time) {
         this.time = time;
         this.glide = !!options.glide;
         for (const listener of this.listeners) listener();
      }
   };
   getGlide = (): boolean => this.glide;
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
export function useFrameTime(clock: PlaybackClock): number {
   return useSyncExternalStore(clock.subscribe, clock.getFrame);
}
