import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { primaryVideo } from "../../../shared/media";
import { clamp } from "../../../shared/time";
import { ClipPriority, selectedClip, trimClip } from "./model";
import type { EditDocument } from "./model";
import { resolveBoundary } from "./navigation";
import { useFrameBoundaries } from "./frameBoundaries";
import type { EditorSession } from "./useEditorSession";

/** Owns clip targeting and accepted edits, including frame resolution and trim gestures. */
export function useEditorInteraction({
   session,
   snapping,
   keyframes,
   onError,
}: {
   session: EditorSession;
   snapping: boolean;
   keyframes: number[];
   onError: (message: string) => void;
}) {
   const { source, editor, documentRef, dispatch, preferences } = session;
   const { clock, seeker, scrubber, playback, videoRef, muted } = session.player;
   const showError = onError;
   const [trimAnimating, setTrimAnimating] = useState(false);
   const trimTimer = useRef(0);
   useEffect(() => () => window.clearTimeout(trimTimer.current), []);
   const [trimming, setTrimmingState] = useState(false);
   const animateTrim = () => {
      setTrimAnimating(true);
      window.clearTimeout(trimTimer.current);
      trimTimer.current = window.setTimeout(() => setTrimAnimating(false), 180);
   };
   const trimmingRef = useRef(false);
   const setTrimming = (active: boolean) => {
      trimmingRef.current = active;
      setTrimmingState(active);
   };
   const [priority] = useState(() => new ClipPriority());
   const pendingBoundary = useRef<number | null>(null);
   const editingTime = () => (pendingBoundary.current === clock.get() ? clock.get() : clock.getFrame());
   // Time displays subscribe separately. The root only updates when the active clip changes.
   useSyncExternalStore(clock.subscribe, () => priority.resolve(editor.document, editingTime())?.id ?? null);
   const [, refreshPriority] = useReducer((value: number) => value + 1, 0);
   const remember = (clip: ReturnType<typeof selectedClip>) => {
      priority.remember(clip);
      refreshPriority();
   };
   const deleteTarget = () => priority.resolve(editor.document, editingTime(), false);
   const targetClip = () => priority.resolve(editor.document, editingTime());
   const currentClip = () => {
      const target = targetClip();
      return editor.document.clips.find((item) => item.id === target?.id);
   };
   const clip = currentClip();
   const timelineDocument = useMemo(() => ({ ...editor.document, selectedId: clip?.id ?? null }), [editor.document, clip?.id]);
   const commit = (document: EditDocument, group?: string) => {
      remember(selectedClip(document));
      dispatch({ type: "commit", document, ...(group ? { group } : {}) });
   };
   const seek = (time: number, preservePriority = false, glide = false, side?: "start" | "end", hover?: number) => {
      if (!source) return;
      const target = clamp(time, 0, source.duration);
      // `hover` is the unquantized pointer position. At frame level the quantized target can
      // sit exactly on a join, where the hovered side is the only thing that says which clip
      // the user is actually over.
      if (!trimmingRef.current && !preservePriority) {
         priority.move(editor.document, clamp(hover ?? target, 0, source.duration));
         refreshPriority();
      }
      playback.previewEnd = null;
      seeker.seek(target, preferences.keepPlaying, glide, side ? (side === "end" ? -1 : 0) : undefined);
      // Scrub bursts only belong to paused seeking; playing video provides its own audio.
      if (videoRef.current?.paused && preferences.audioScrub) scrubber.scrub(target, muted ? 0 : preferences.volume, side);
   };
   const alignResolvedBoundary = useCallback(
      (times: Map<number, number>) => {
         const requested = clock.get();
         const actual = times.get(requested);
         if (pendingBoundary.current !== null) {
            pendingBoundary.current = null;
            refreshPriority();
         }
         if (actual === undefined || actual === requested || !videoRef.current?.paused || trimmingRef.current) return;
         const ending = documentRef.current.clips.some((clip) => clip.end === requested);
         const starting = documentRef.current.clips.some((clip) => clip.start === requested);
         // Keep the timeline at the accepted cutoff. End previews still show the last kept frame.
         seeker.seek(actual, false, false, ending && !starting ? -1 : 0);
      },
      [clock, seeker, videoRef, documentRef]
   );
   useFrameBoundaries(source, editor.document, dispatch, showError, alignResolvedBoundary);
   const frameStep = 1 / ((source && primaryVideo(source)?.frameRate) || 100);
   const setBoundary = (side: "start" | "end", value: number, target = clip) => {
      const clip = target;
      if (source && clip) {
         const time = resolveBoundary(editor.document, clip.id, side, value, {
            duration: source.duration,
            frameStep,
            snapping,
            keyframes,
         });
         const next = trimClip(editor.document, clip.id, side, time, source.duration);
         const actual = next.clips.find((item) => item.id === clip.id)![side];
         if (actual === clip[side]) return actual;
         animateTrim();
         pendingBoundary.current = actual;
         commit(next);
         seeker.seek(actual, preferences.keepPlaying, false, side === "end" ? -1 : 0);
         return actual;
      }
      return value;
   };
   return {
      clip,
      timelineDocument,
      trimming,
      trimmingRef,
      trimAnimating,
      setTrimming,
      remember,
      commit,
      seek,
      currentClip,
      deleteTarget,
      frameStep,
      animateTrim,
      setBoundary,
   };
}
export type EditorInteraction = ReturnType<typeof useEditorInteraction>;
