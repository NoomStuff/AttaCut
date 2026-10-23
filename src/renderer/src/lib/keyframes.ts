import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { MediaSource } from "../../../shared/types";
import { afterIdle } from "./prefetch";
import { errorText } from "./errors";

export interface KeyframeOptions {
   source: MediaSource | null;
   snapping: boolean;
   loading: boolean;
   preparing: boolean;
   videoRef: RefObject<HTMLVideoElement | null>;
   /** Optional prefetch failures are only reported when snapping was requested. */
   onError: (message: string) => void;
}

/**
 * Keyframes of the active source for snapping. An explicit request (snapping) reads
 * immediately; otherwise the read waits for the preview to decode and an idle slot.
 * Keyframes stay cached per source until the source changes.
 */
export function useKeyframes({ source, snapping, loading, preparing, videoRef, onError }: KeyframeOptions): { keyframes: number[]; reading: boolean } {
   const [keyframes, setKeyframes] = useState<number[]>([]);
   const [reading, setReading] = useState(false);
   const ready = useRef<string | null>(null);
   const loadedFor = useRef<string | null>(null);
   useEffect(() => {
      if (loadedFor.current !== (source?.id ?? null)) {
         loadedFor.current = source?.id ?? null;
         setKeyframes([]);
         setReading(false);
      }
      if (!source || loading || ready.current === source.id) return;
      let cancelled = false;
      let cancelIdle = () => {};
      const read = () => {
         setReading(snapping);
         void window.desktop
            .keyframes(source.id)
            .then((keys) => {
               if (!cancelled) {
                  ready.current = source.id;
                  setKeyframes(keys);
               }
            })
            .catch((value: unknown) => {
               if (!cancelled && snapping) onError(errorText(value));
            })
            .finally(() => {
               if (!cancelled) setReading(false);
            });
      };
      const video = videoRef.current;
      const schedule = () => {
         cancelIdle();
         cancelIdle = afterIdle(read);
      };
      // An explicit request bypasses prefetch scheduling. Otherwise let the preview decode first.
      if (snapping) read();
      else if (!preparing && video) {
         if (video.readyState >= 2) schedule();
         else video.addEventListener("loadeddata", schedule, { once: true });
      }
      return () => {
         cancelled = true;
         cancelIdle();
         video?.removeEventListener("loadeddata", schedule);
      };
   }, [source, snapping, loading, preparing, videoRef, onError]);
   return { keyframes, reading };
}
