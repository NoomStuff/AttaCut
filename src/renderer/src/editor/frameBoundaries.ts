import { useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import type { Dispatch } from "react";
import type { MediaSource } from "../../../shared/types";
import type { EditAction, EditDocument } from "./model";
import { errorText, isCancellation } from "../lib/errors";

/** Pointer requests remain immediate. A committed edit resolves once to source timestamps. */
export function useFrameBoundaries(
   source: MediaSource | null,
   document: EditDocument,
   dispatch: Dispatch<EditAction>,
   onError: (message: string) => void,
   onResolved: (times: Map<number, number>) => void
): void {
   const index = useMemo(() => ({ sourceId: source?.id, times: new Map<number, number>() }), [source?.id]);
   const times = index.times;
   useEffect(() => {
      if (!source) return;
      const pending = [...new Set(document.clips.flatMap((clip) => [clip.start, clip.end]))].filter(
         (time) => time !== 0 && time !== source.duration && !times.has(time)
      );
      if (!pending.length) {
         onResolved(times);
         return;
      }
      let current = true;
      void window.desktop
         .frameTimes(source.id, pending)
         .then((resolved) => {
            for (const [position, time] of pending.entries()) {
               const frame = resolved[position]!;
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
            // Commit accepted boundaries before moving the clock to them. Otherwise a
            // rounded start can briefly look like a gap and unmount the editing fields.
            flushSync(() => {
               dispatch({ type: "resolve", document, times });
               onResolved(times);
            });
         })
         .catch((error: unknown) => {
            if (current && !isCancellation(errorText(error))) onError(errorText(error));
         });
      return () => {
         current = false;
      };
   }, [source, document, times, dispatch, onError, onResolved]);
}
