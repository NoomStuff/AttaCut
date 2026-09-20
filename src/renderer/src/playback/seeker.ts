import type { PlaybackClock } from "./clock";

/** Let each decode finish instead of starving it with repeated currentTime writes. */
export class PlaybackSeeker {
   private requested: number | null = null;
   private video: HTMLVideoElement | null = null;
   private scheduled = 0;
   private revision = 0;
   private resolving = false;
   private resolveTime: ((time: number) => Promise<number>) | null = null;
   configure(resolveTime: ((time: number) => Promise<number>) | null): void {
      this.revision++;
      this.resolving = false;
      this.requested = null;
      this.resolveTime = resolveTime;
   }
   constructor(private readonly clock: PlaybackClock) {}
   get pending(): boolean {
      return this.requested !== null || this.scheduled !== 0 || this.resolving;
   }
   attach(video: HTMLVideoElement): () => void {
      this.video = video;
      const complete = () => {
         this.scheduled = requestAnimationFrame(() => {
            this.scheduled = 0;
            this.flush();
         });
      };
      video.addEventListener("seeked", complete);
      return () => {
         video.removeEventListener("seeked", complete);
         cancelAnimationFrame(this.scheduled);
         this.scheduled = 0;
         this.requested = null;
         this.video = null;
         this.revision++;
         this.resolving = false;
      };
   }
   seek(time: number, keepPlaying = false): void {
      this.revision++;
      this.clock.set(time);
      this.requested = time;
      if (!keepPlaying) this.video?.pause();
      this.flush();
   }
   private flush(): void {
      const video = this.video;
      if (!video?.readyState || video.seeking || this.scheduled || this.requested === null) return;
      const time = this.requested;
      this.requested = null;
      const revision = this.revision;
      if (!this.resolveTime) {
         if (Math.abs(video.currentTime - time) > 0.00001) video.currentTime = time;
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
            if (revision === this.revision) this.resolving = false;
         });
   }
}
