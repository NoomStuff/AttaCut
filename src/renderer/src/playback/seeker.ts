import type { PlaybackClock } from "./clock";

/** Let each decode finish instead of starving it with repeated currentTime writes. */
export class PlaybackSeeker {
   private requested: number | null = null;
   private video: HTMLVideoElement | null = null;
   private scheduled = 0;
   private revision = 0;
   private lifetime = 0;
   private resolving = false;
   private resolveTime: ((time: number) => Promise<number>) | null = null;
   private waitingForFrame = false;
   private waitingListeners = new Set<() => void>();
   private progressCount = 0;
   private progressListeners = new Set<() => void>();
   getWaiting = (): boolean => this.waitingForFrame;
   subscribeWaiting = (listener: () => void): (() => void) => {
      this.waitingListeners.add(listener);
      return () => this.waitingListeners.delete(listener);
   };
   getProgress = (): number => this.progressCount;
   subscribeProgress = (listener: () => void): (() => void) => {
      this.progressListeners.add(listener);
      return () => this.progressListeners.delete(listener);
   };
   /** Counts frames the pipeline produced, so a wait indicator keyed on it can tell a stall
       from continuous skimming, which keeps a request pending without dropping frames. */
   private bumpProgress(): void {
      this.progressCount++;
      this.progressListeners.forEach((listener) => listener());
   }
   private setWaiting(waiting: boolean): void {
      if (this.waitingForFrame === waiting) return;
      this.waitingForFrame = waiting;
      this.waitingListeners.forEach((listener) => listener());
   }
   private finishIfReady(): void {
      if (this.requested === null && !this.resolving && !this.scheduled && !this.video?.seeking) this.setWaiting(false);
   }
   configure(resolveTime: ((time: number) => Promise<number>) | null): void {
      this.lifetime++;
      this.revision++;
      this.resolving = false;
      this.requested = null;
      this.resolveTime = resolveTime;
      this.setWaiting(false);
   }
   private readonly clock: PlaybackClock;
   constructor(clock: PlaybackClock) {
      this.clock = clock;
   }
   get pending(): boolean {
      return this.requested !== null || this.scheduled !== 0 || this.resolving;
   }
   attach(video: HTMLVideoElement): () => void {
      this.video = video;
      const complete = () => {
         this.bumpProgress();
         this.scheduled = requestAnimationFrame(() => {
            this.scheduled = 0;
            this.flush();
            this.finishIfReady();
         });
      };
      const ready = () => this.flush();
      video.addEventListener("seeked", complete);
      video.addEventListener("loadedmetadata", ready);
      video.addEventListener("loadeddata", ready);
      return () => {
         video.removeEventListener("seeked", complete);
         video.removeEventListener("loadedmetadata", ready);
         video.removeEventListener("loadeddata", ready);
         cancelAnimationFrame(this.scheduled);
         this.scheduled = 0;
         this.requested = null;
         this.video = null;
         this.lifetime++;
         this.revision++;
         this.resolving = false;
         this.setWaiting(false);
      };
   }
   seek(time: number, keepPlaying = false, glide = false): void {
      this.revision++;
      this.clock.set(time, { glide });
      this.requested = time;
      this.setWaiting(true);
      if (!keepPlaying) this.video?.pause();
      this.flush();
   }
   private flush(): void {
      const video = this.video;
      // One resolve at a time: a seek arriving mid-resolve waits for it, then flushes below.
      if (!video?.readyState || video.seeking || this.scheduled || this.resolving || this.requested === null) return;
      const time = this.requested;
      this.requested = null;
      const revision = this.revision;
      const lifetime = this.lifetime;
      if (!this.resolveTime) {
         if (Math.abs(video.currentTime - time) > 0.00001) video.currentTime = time;
         this.finishIfReady();
         return;
      }
      this.resolving = true;
      void this.resolveTime(time)
         .then((resolved) => {
            if (revision === this.revision && this.video === video && Math.abs(video.currentTime - resolved) > 0.00001) video.currentTime = resolved;
         })
         .catch(() => {
            // Keep immediate navigation usable if optional timestamp analysis fails.
            if (revision === this.revision && this.video === video) video.currentTime = time;
         })
         .finally(() => {
            // A replaced source may already have its own resolve in flight.
            if (lifetime !== this.lifetime) return;
            this.resolving = false;
            this.bumpProgress();
            this.flush();
            this.finishIfReady();
         });
   }
}
