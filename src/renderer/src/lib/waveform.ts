import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { MediaSource } from "../../../shared/types";
import { waveformResolution } from "../../../shared/media";
import type { PlaybackSeeker } from "../playback/seeker";
import { WaveformRenderer } from "./waveform-renderer";
import { afterIdle } from "./prefetch";
export type Waveform = WaveformRenderer;

/**
 * Audio min/max peaks of the active source for the timeline waveform, following the
 * playback audio selection. Decoding waits for the preview's first frame and then runs in
 * the background, streaming peak ranges back as they are done; results stay cached per
 * source and track selection until they change.
 */
export function useWaveform({
   source,
   enabled,
   audioIndices,
   decodeMediaId,
   videoRef,
   seeker,
}: {
   source: MediaSource | null;
   enabled: boolean;
   audioIndices: number[];
   /** Media id to decode from: the source itself, or the prepared preview once a
       recording that needs a transcode has swapped to it. Null holds the fetch. */
   decodeMediaId: string | null;
   videoRef: RefObject<HTMLVideoElement | null>;
   seeker: PlaybackSeeker;
}): Waveform | null {
   const [waveformState, setWaveformState] = useState<{ signature: string; value: Waveform } | null>(null);
   const tracks = [...audioIndices].sort((a, b) => a - b).join(",");
   const signature = source && tracks && source.duration > 0 ? `${source.id}:${tracks}:${decodeMediaId}` : null;
   useEffect(() => {
      const setWaveform = (value: Waveform | null) => setWaveformState(value && signature ? { signature, value } : null);
      if (!signature || !source || !enabled) {
         // Peaks can reach tens of megabytes for long recordings; drop them once unused.
         setWaveform(null);
         return;
      }
      // No preview to decode from yet: recordings that need a transcode get their waveform
      // from that compact preview instead of walking the huge source, so hold until the
      // player swaps to it.
      setWaveform(null);
      if (!decodeMediaId) return;
      const requestId = crypto.randomUUID();
      let cancelled = false;
      let unsubscribe = () => {};
      let cancelIdle = () => {};
      let started = false;
      let regionTimer = 0;
      let pendingRegion: { from: number; to: number } | null = null;
      const requestRegion = (from: number, to: number) => {
         pendingRegion = { from, to };
         window.clearTimeout(regionTimer);
         regionTimer = window.setTimeout(() => {
            if (!cancelled && started && !busy()) {
               pendingRegion = null;
               void window.desktop.waveformRegion(requestId, from, to).catch(() => undefined);
            }
         }, 750);
      };
      const nearPlayhead = () => {
         if (!video || video.currentTime < 15) return;
         requestRegion(Math.max(0, video.currentTime - 15), Math.min(source.duration, video.currentTime + 15));
      };
      let renderer: WaveformRenderer | null = null;
      const video = videoRef.current;
      let pointerHeld = false;
      let wheelActive = false;
      let startingPlayback = false;
      let lastBusy: boolean | null = null;
      const busy = () => !!video?.seeking || seeker.getWaiting() || pointerHeld || wheelActive || startingPlayback;
      const activity = () => {
         if (started) {
            const current = busy();
            if (lastBusy === current) return;
            lastBusy = current;
            void window.desktop.waveformActivity(requestId, current).catch(() => undefined);
            if (!current && pendingRegion) requestRegion(pendingRegion.from, pendingRegion.to);
         } else ready();
      };
      const unwatchSeek = seeker.subscribeWaiting(activity);
      const seek = () => {
         activity();
         if (!video?.seeking) nearPlayhead();
      };
      const settled = () => {
         pointerHeld = false;
         activity();
      };
      const blurred = () => {
         pointerHeld = false;
         wheelActive = false;
         activity();
      };
      const play = () => {
         startingPlayback = true;
         activity();
      };
      const playable = () => {
         startingPlayback = false;
         activity();
      };
      const waiting = () => {
         if (!video?.paused) play();
      };
      const loaded = () => {
         if (video?.paused) playable();
      };
      const pointer = (event: PointerEvent) => {
         if ((event.target as Element)?.closest?.(".timeline-section")) {
            pointerHeld = true;
            activity();
         }
      };
      const wheel = (event: WheelEvent) => {
         if ((event.target as Element)?.closest?.(".timeline-section")) {
            wheelActive = true;
            activity();
            window.clearTimeout(wheelTimer);
            wheelTimer = window.setTimeout(() => {
               wheelActive = false;
               activity();
            }, 200);
         }
      };
      let wheelTimer = 0;
      video?.addEventListener("seeking", seek);
      video?.addEventListener("seeked", seek);
      video?.addEventListener("play", play);
      video?.addEventListener("waiting", waiting);
      video?.addEventListener("loadeddata", loaded);
      video?.addEventListener("playing", playable);
      video?.addEventListener("canplay", playable);
      video?.addEventListener("pause", playable);
      video?.addEventListener("error", playable);
      document.addEventListener("pointerdown", pointer, true);
      document.addEventListener("pointerup", settled, true);
      document.addEventListener("pointercancel", settled, true);
      document.addEventListener("lostpointercapture", settled, true);
      window.addEventListener("blur", blurred);
      document.addEventListener("wheel", wheel, { passive: true });
      const read = async () => {
         if (busy() || cancelled || started) return;
         started = true;
         const rate = waveformResolution(source.duration);
         if (!rate) return;
         renderer = new WaveformRenderer(
            source.duration,
            () => {
               renderer?.dispose();
               unsubscribe();
               setWaveform(null);
               void window.desktop.cancelWaveform(requestId).catch(() => undefined);
            },
            requestRegion
         );
         setWaveform(renderer);
         const total = Math.ceil(source.duration * rate);
         let done = 0;
         unsubscribe = window.desktop.onWaveformChunk((chunk) => {
            if (cancelled || chunk.sourceId !== source.id || chunk.requestId !== requestId) return;
            // Never reveal gaps or mix chunks from an old track selection.
            if (
               chunk.rate !== rate ||
               chunk.peaks.length % 3 !== 0 ||
               !Number.isInteger(chunk.offset) ||
               chunk.offset < 0 ||
               chunk.offset + chunk.peaks.length / 3 > total
            )
               return;
            if (chunk.priority) {
               renderer?.append(chunk.offset, chunk.peaks, true);
               return;
            }
            if (chunk.offset !== done) return;
            done = Math.max(done, chunk.offset + chunk.peaks.length / 3);
            renderer?.append(chunk.offset, chunk.peaks);
         });
         nearPlayhead();
         try {
            const result = await window.desktop.waveformStart({ sourceId: source.id, requestId, streamIndices: tracks.split(",").map(Number), decodeMediaId });
            if (cancelled) return;
            unsubscribe();
            if (result?.rate === rate && result.buckets === done && done === total) renderer.complete();
         } catch {
            unsubscribe();
            // A waveform is decoration: a failed decode leaves it partial without an error,
            // and diagnostics already recorded the ffmpeg outcome.
         }
      };
      // Wait for actual playable video, then let its first frame and editor input settle.
      const ready = () => {
         if (!video || video.readyState < 2 || busy() || started) return;
         cancelIdle();
         cancelIdle = afterIdle(() => void read(), 0);
      };
      video?.addEventListener("loadeddata", ready);
      video?.addEventListener("canplay", ready);
      ready();
      return () => {
         cancelled = true;
         unsubscribe();
         cancelIdle();
         renderer?.dispose();
         unwatchSeek();
         window.clearTimeout(wheelTimer);
         window.clearTimeout(regionTimer);
         video?.removeEventListener("loadeddata", ready);
         video?.removeEventListener("canplay", ready);
         video?.removeEventListener("seeking", seek);
         video?.removeEventListener("seeked", seek);
         video?.removeEventListener("play", play);
         video?.removeEventListener("waiting", waiting);
         video?.removeEventListener("loadeddata", loaded);
         video?.removeEventListener("playing", playable);
         video?.removeEventListener("canplay", playable);
         video?.removeEventListener("pause", playable);
         video?.removeEventListener("error", playable);
         document.removeEventListener("pointerdown", pointer, true);
         document.removeEventListener("pointerup", settled, true);
         document.removeEventListener("pointercancel", settled, true);
         document.removeEventListener("lostpointercapture", settled, true);
         window.removeEventListener("blur", blurred);
         document.removeEventListener("wheel", wheel);
         if (started) void window.desktop.cancelWaveform(requestId).catch(() => undefined);
      };
   }, [source, enabled, signature, tracks, decodeMediaId, videoRef, seeker]);
   return enabled && waveformState?.signature === signature ? waveformState.value : null;
}
