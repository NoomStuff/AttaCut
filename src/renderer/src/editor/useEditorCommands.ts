import { useRef } from "react";
import type { ExportJob } from "../../../shared/types";
import { clipLimit } from "../../../shared/defaults";
import { adjacentBoundary, neighboringKeyframe, splitTargetAt } from "./navigation";
import { frameLevelActive } from "./timelineView";
import { nextKeptTime } from "../playback/ranges";
import { mergePair, mergeClips, addGap, canSplit, deleteClip, gapAt, minClipLength, selectedClip, splitClip } from "./model";
import type { EditDocument } from "./model";
import { guardCommands, resolvedCommand } from "./commands";
import type { Commands } from "./commands";
import type { EditorSession } from "./useEditorSession";
import type { EditorInteraction } from "./useEditorInteraction";
import { errorText } from "../lib/errors";

export type EditorPanel = "export" | "frame" | "settings" | "shortcuts" | "help" | "about" | null;
const releasesUrl = "https://github.com/NoomStuff/AttaCut/releases";
interface EditorViewActions {
   openPanel: (panel: EditorPanel) => void;
   openSettings: (tab: "general" | "editing") => void;
   toggleFullscreen: () => void;
   showClip: (clip: { start: number; end: number }, zoom: boolean) => void;
   fit: () => void;
   zoom: (direction: -1 | 1) => void;
   confirmReset: () => void;
   openHelp: () => void;
   checkForUpdates: () => void;
}

/** Builds the same guarded actions for menus, buttons and shortcuts. */
export function useEditorCommands({
   session,
   editing,
   view,
   keyframes,
   readingKeys,
   snapping,
   zoom,
   job,
   onError,
   onWarning,
}: {
   session: EditorSession;
   editing: EditorInteraction;
   view: EditorViewActions;
   keyframes: number[];
   readingKeys: boolean;
   snapping: boolean;
   zoom: number;
   job: ExportJob | null;
   onError: (message: string) => void;
   onWarning: (message: string) => void;
}) {
   const {
      source,
      sourceRef,
      editor,
      dispatch,
      preferences,
      setPreferences,
      ready,
      loading,
      savingProject,
      choose,
      saveProject,
      confirmProject,
      closeProject,
   } = session;
   const { muted, setMuted, playback, preparing, videoRef, clock, seeker } = session.player;
   const { clip, trimming, trimmingRef, remember, commit, seek, currentClip, deleteTarget, frameStep, animateTrim, setBoundary } = editing;
   const showError = onError;
   const togglePlay = () => {
      const video = videoRef.current;
      if (!video) return;
      playback.previewEnd = null;
      if (playback.get().intent === "requested") {
         video.pause();
         playback.pause();
         return;
      }
      if (!video.paused) {
         playback.pause();
         video.pause();
         return;
      }
      const time = clock.get();
      if (preferences.keptOnly && editor.document.clips.length) {
         seeker.seek(nextKeptTime(editor.document.clips, time) ?? editor.document.clips[0]!.start, true);
      } else if (source && time >= source.duration - 0.02) seeker.seek(0, true);
      playback.request(true);
      if (preparing) return;
      void video.play().catch(() => undefined);
   };
   // A pure bounds edit animates the clip to its new shape, undo and redo included, so a
   // trimmed edge visibly travels back. Structural edits (split, merge, add, delete) keep
   // their own presence animations: gliding bounds would fight the seam and enter/exit cues.
   const sameClipIds = (a: EditDocument, b: EditDocument) =>
      a.clips.length === b.clips.length && a.clips.every((clip, index) => clip.id === b.clips[index]?.id);
   const minimumClipLength = () => minClipLength(frameStep);
   const available = () => !!source && !loading && !trimmingRef.current;
   const warnClipLimit = () => onWarning(`This timeline has reached ${clipLimit.toLocaleString()} clips. Merge or delete a clip before adding another.`);
   const frameSequence = useRef(0);
   const stepFrame = (direction: -1 | 1) => {
      videoRef.current?.pause();
      playback.previewEnd = null;
      const sequence = ++frameSequence.current;
      const id = source!.id;
      const video = videoRef.current;
      const from =
         clock.getResolved() ??
         (seeker.pending || video?.seeking ? clock.get() : ((video && clock.getDisplayed(video.currentSrc)) ?? video?.currentTime ?? clock.get()));
      void window.desktop
         .frameTime(id, from, direction)
         .then((target) => {
            if (sequence === frameSequence.current && sourceRef.current?.id === id) seek(target, false, true, "start");
         })
         .catch((value: unknown) => {
            if (sourceRef.current?.id === id) showError(errorText(value));
         });
   };
   const joinAtPlayhead = () => mergePair(editor.document, clock.get(), frameStep, frameStep / 2);
   const navigate = (resolveTime: () => number | null) =>
      resolvedCommand(() => {
         if (!available()) return;
         const target = resolveTime();
         if (target !== null) return () => seek(target, false, true);
      });
   const trimCommand = (side: "start" | "end") =>
      resolvedCommand(() => {
         if (!available()) return;
         const target = currentClip();
         const time = clock.get();
         if (target && time > target.start && time < target.end) return () => setBoundary(side, time, target);
      });
   const commands: Commands = guardCommands({
      frameBack: { enabled: available, run: () => stepFrame(-1) },
      frameForward: { enabled: available, run: () => stepFrame(1) },
      mute: {
         enabled: available,
         run: () => {
            setMuted(!muted && preferences.volume > 0);
            if (preferences.volume === 0) setPreferences({ ...preferences, volume: 0.7 });
         },
      },
      snap: {
         enabled: () => available() && (preferences.snapping || !readingKeys),
         run: () => setPreferences((current) => ({ ...current, snapping: !current.snapping })),
      },
      merge: resolvedCommand(() => {
         if (!available()) return;
         const index = joinAtPlayhead();
         if (index < 0) return;
         return () => {
            const boundary = editor.document.clips[index]!.end;
            commit(mergeClips(editor.document, index));
            seek(boundary, true);
         };
      }),
      toggleClip: {
         ...resolvedCommand(() => {
            const action = currentClip() ? commands.delete : commands.add;
            return action.resolve?.();
         }),
         feedback: () => (currentClip() ? "delete" : "add"),
      },
      open: {
         enabled: () => ready && !savingProject,
         run: () => {
            void choose();
         },
      },
      saveProject: {
         enabled: () => !!source && !loading && !savingProject && !trimming,
         run: () => {
            void saveProject();
         },
      },
      saveProjectAs: {
         enabled: () => !!source && !loading && !savingProject && !trimming,
         run: () => {
            void saveProject(true);
         },
      },
      export: {
         enabled: () => available() && !!editor.document.clips.length && !job?.running,
         run: () => {
            videoRef.current?.pause();
            view.openPanel("export");
         },
      },
      play: { enabled: available, run: togglePlay },
      // Fullscreen stays usable while a handle is held; only a load takes it away.
      fullscreen: { enabled: () => !!source && !loading, run: view.toggleFullscreen },
      frame: {
         enabled: available,
         run: () => {
            videoRef.current?.pause();
            view.openPanel("frame");
         },
      },
      preview: {
         enabled: () => available() && !!clip,
         run: () => {
            if (!clip || !videoRef.current) return;
            // Bring the clip on screen before playing it: previewing something off-view
            // reads as nothing happening.
            view.showClip(clip, false);
            seeker.seek(clip.start, true);
            playback.previewEnd = clip.end;
            playback.request(true);
            if (!preparing) void videoRef.current.play().catch(() => undefined);
         },
      },
      back: { enabled: available, run: () => seek(clock.get() - 1, false, true) },
      forward: { enabled: available, run: () => seek(clock.get() + 1, false, true) },
      backFast: { enabled: available, run: () => seek(clock.get() - 5, false, true) },
      forwardFast: { enabled: available, run: () => seek(clock.get() + 5, false, true) },
      previousKeyframe: navigate(() => neighboringKeyframe(clock.get(), -1, keyframes)),
      nextKeyframe: navigate(() => neighboringKeyframe(clock.get(), 1, keyframes)),
      previous: navigate(() => adjacentBoundary(editor.document.clips, clock.get(), -1)),
      next: navigate(() => adjacentBoundary(editor.document.clips, clock.get(), 1)),
      split: resolvedCommand(() => {
         if (!available()) return;
         // Up close the frame grid replaces keyframe snapping, so an unloaded keyframe
         // index is no reason to hold the split back either.
         const frameLevel = frameLevelActive((source!.duration * 100) / zoom, frameStep);
         if (snapping && readingKeys && !frameLevel) return;
         const target = currentClip();
         if (!target) return;
         if (editor.document.clips.length >= clipLimit) return warnClipLimit;
         const current = clock.get();
         const time = splitTargetAt(editor.document, target.id, current, { snapping: snapping && !frameLevel, keyframes });
         const minimum = minimumClipLength();
         if (!canSplit(editor.document, target.id, current, minimum) || !canSplit(editor.document, target.id, time, minimum)) return;
         return () => {
            const next = splitClip(editor.document, target.id, time, minimum);
            commit(next);
            seeker.seek(time, preferences.keepPlaying);
         };
      }),
      setStart: trimCommand("start"),
      setEnd: trimCommand("end"),
      delete: resolvedCommand(() => {
         if (!available()) return;
         const target = deleteTarget();
         if (!target) return;
         return () => {
            commit(deleteClip(editor.document, target.id));
            remember(target);
         };
      }),
      add: resolvedCommand(() => {
         if (!available()) return;
         const time = clock.get();
         const gap = gapAt(editor.document, time, source!.duration);
         // Container rounding can leave a one-frame gap a hair under the minimum; the
         // resolver aligns the new clip to the grid, so half a frame of slack is safe.
         if (!gap || gap.end - gap.start < minimumClipLength() / 2) return;
         if (editor.document.clips.length >= clipLimit) return warnClipLimit;
         return () => commit(addGap(editor.document, time, source!.duration));
      }),
      undo: {
         enabled: () => available() && !!editor.past.length,
         run: () => {
            const previous = editor.past.at(-1)!;
            if (sameClipIds(editor.document, previous)) animateTrim();
            remember(selectedClip(previous));
            dispatch({ type: "undo" });
         },
      },
      redo: {
         enabled: () => available() && !!editor.future.length,
         run: () => {
            const next = editor.future[0]!;
            if (sameClipIds(editor.document, next)) animateTrim();
            remember(selectedClip(editor.future[0]!));
            dispatch({ type: "redo" });
         },
      },
      fit: { enabled: available, run: view.fit },
      zoomIn: { enabled: available, run: () => view.zoom(1) },
      zoomOut: { enabled: available, run: () => view.zoom(-1) },
      focusClip: {
         enabled: () => available() && !!clip,
         run: () => {
            if (!clip) return;
            view.showClip(clip, true);
         },
      },
      options: { enabled: () => ready, run: () => view.openSettings("general") },
      settings: { enabled: () => ready, run: () => view.openSettings("editing") },
      shortcuts: { enabled: () => ready, run: () => view.openPanel("shortcuts") },
      closeProject: {
         enabled: () => (!!source || loading) && !savingProject,
         run: () => {
            void confirmProject().then((proceed) => {
               if (proceed) closeProject();
            });
         },
      },
      quit: { enabled: () => true, run: () => window.desktop.windowAction("close") },
      releases: {
         enabled: () => ready,
         run: () => {
            void window.desktop.openExternal(releasesUrl).catch((value) => showError(errorText(value)));
         },
      },
      reset: { enabled: () => ready, run: view.confirmReset },
      help: {
         enabled: () => ready,
         run: () => {
            view.openHelp();
         },
      },
      about: { enabled: () => ready, run: () => view.openPanel("about") },
      updates: { enabled: () => ready, run: view.checkForUpdates },
   });
   return { commands, togglePlay };
}
