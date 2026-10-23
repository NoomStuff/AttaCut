import type { PlaybackController } from "./controller";
import type { PlaybackSeeker } from "./seeker";

/** Starts requested playback once the current media is ready. All play actions use this path. */
export function connectPlayback(video: HTMLVideoElement, playback: PlaybackController, seeker: PlaybackSeeker, onFailure: () => void): () => void {
   let disposed = false;
   let starting = false;
   const start = () => {
      const state = playback.get();
      if (
         disposed ||
         starting ||
         seeker.getWaiting() ||
         state.intent !== "requested" ||
         (state.phase !== "source" && state.phase !== "preview") ||
         !video.readyState ||
         video.currentSrc !== state.url
      )
         return;
      starting = true;
      void video
         .play()
         .catch((error: unknown) => {
            // A pause or source replacement routinely aborts play(). Only the active
            // request may trigger a fallback, and AbortError never indicates bad media.
            const latest = playback.get();
            if (!disposed && latest === state && !(error instanceof DOMException && error.name === "AbortError")) onFailure();
         })
         .finally(() => {
            starting = false;
            if (playback.get() !== state) ready();
         });
   };
   // Let metadata handlers choose audio or request a preview before trying to play.
   const ready = () => queueMicrotask(start);
   const unsubscribe = playback.subscribe(ready);
   const unwatchSeek = seeker.subscribeWaiting(ready);
   video.addEventListener("loadedmetadata", ready);
   video.addEventListener("canplay", ready);
   ready();
   return () => {
      disposed = true;
      unsubscribe();
      unwatchSeek();
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("canplay", ready);
   };
}
