import type { MediaSource } from "../../../shared/types";

type MediaState =
   | { phase: "empty"; sourceId: null; url: ""; transcode: false }
   | { phase: "source" | "preparing" | "preview" | "failed"; sourceId: string; url: string; transcode: boolean };
export type PlaybackState = MediaState & { intent: "paused" | "requested" | "playing"; showWait: boolean };

/** Owns preview identity and playback intent independently of video-element events. */
export class PlaybackController {
   private state: PlaybackState = { phase: "empty", sourceId: null, url: "", transcode: false, intent: "paused", showWait: false };
   private sequence = 0;
   private listeners = new Set<() => void>();
   get = (): PlaybackState => this.state;
   subscribe = (listener: () => void): (() => void) => {
      this.listeners.add(listener);
      return () => {
         this.listeners.delete(listener);
      };
   };
   private set(state: PlaybackState): void {
      this.state = state;
      for (const listener of this.listeners) listener();
   }
   invalidate(): void {
      this.sequence++;
      this.pause();
   }
   suspend(): void {
      this.sequence++;
      if (this.state.sourceId) this.set({ ...this.state, phase: "source", url: "", intent: "paused", showWait: false });
   }
   source(source: MediaSource): void {
      this.sequence++;
      this.set({ phase: "source", sourceId: source.id, url: source.url, transcode: false, intent: "paused", showWait: false });
   }
   request(showWait: boolean): void {
      this.set({ ...this.state, intent: "requested", showWait: this.state.showWait || showWait });
   }
   pause(): void {
      this.set({ ...this.state, intent: "paused", showWait: false });
   }
   playing(): void {
      this.set({ ...this.state, intent: "playing", showWait: false });
   }
   fail(): void {
      if (this.state.phase !== "empty") this.set({ ...this.state, phase: "failed", intent: "paused", showWait: false });
   }
   async prepare(sourceId: string, transcode: boolean, load: () => Promise<string>, beforeSwap?: (url: string) => void): Promise<void> {
      if (this.state.sourceId !== sourceId) return;
      const sequence = ++this.sequence;
      this.set({ ...this.state, phase: "preparing", sourceId, transcode });
      try {
         const url = await load();
         if (sequence === this.sequence && this.state.sourceId === sourceId) {
            if (url !== this.state.url) beforeSwap?.(url);
            this.set({ ...this.state, phase: "preview", sourceId, url, transcode });
         }
      } catch (error) {
         if (sequence !== this.sequence || this.state.sourceId !== sourceId) return;
         this.fail();
         throw error;
      }
   }
}
