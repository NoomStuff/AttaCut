import { useEffect, useMemo } from "react";
import type { Dispatch } from "react";
import type { MediaSource } from "../../../shared/types";
import type { EditAction, EditDocument } from "./model";
import { errorText, isCancellation } from "../lib/errors";

/** Pointer requests remain immediate. A committed edit resolves once to source timestamps. */
export function useFrameBoundaries(
   source: MediaSource | null,
   document: EditDocument,
   dispatch: Dispatch<EditAction>,
   onError: (message: string) => void
): boolean {
   const index = useMemo(() => ({ sourceId: source?.id, times: new Map<number, number>() }), [source?.id]);
   const times = index.times;
   const requested = [...new Set(document.clips.flatMap((clip) => [clip.start, clip.end]))].filter(
      (time) => source && time !== 0 && time !== source.duration && !times.has(time)
   );
   useEffect(() => {
      if (!source) return;
      const pending = [...new Set(document.clips.flatMap((clip) => [clip.start, clip.end]))].filter(
         (time) => time !== 0 && time !== source.duration && !times.has(time)
      );
      if (!pending.length) return;
      let current = true;
      void Promise.all(pending.map(async (time) => [time, await window.desktop.frameTime(source.id, time, 0)] as const))
         .then((resolved) => {
            for (const [time, frame] of resolved) {
               times.set(time, frame);
               times.set(frame, frame);
            }
            if (!current) return;
            for (const clip of document.clips) {
               if ((times.get(clip.end) ?? clip.end) <= (times.get(clip.start) ?? clip.start)) {
                  onError("This clip is shorter than one source frame. Move a boundary before exporting.");
                  return;
               }
            }
            dispatch({ type: "resolve", document, times });
         })
         .catch((error: unknown) => {
            if (current && !isCancellation(errorText(error))) onError(errorText(error));
         });
      return () => {
         current = false;
      };
   }, [source, document, times, dispatch, onError]);
   return requested.length > 0;
}
