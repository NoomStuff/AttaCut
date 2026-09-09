import { useSyncExternalStore } from "react";
export class PlaybackClock {
   private time = 0;
   private listeners = new Set<() => void>();
   get = (): number => this.time;
   set = (time: number): void => {
      if (time !== this.time) {
         this.time = time;
         for (const listener of this.listeners) listener();
      }
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
