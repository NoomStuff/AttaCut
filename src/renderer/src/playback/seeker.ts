import type { PlaybackClock } from "./clock";

/** Let each decode finish instead of starving it with repeated currentTime writes. */
export class PlaybackSeeker {
   private requested: number | null = null;
   private video: HTMLVideoElement | null = null;
   private scheduled = 0;
   constructor(private readonly clock: PlaybackClock) {}
   get pending(): boolean {
      return this.requested !== null || this.scheduled !== 0;
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
      };
   }
   seek(time: number, keepPlaying = false): void {
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
      if (Math.abs(video.currentTime - time) > 0.00001) video.currentTime = time;
   }
}
