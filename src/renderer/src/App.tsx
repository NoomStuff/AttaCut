import { usePlayback } from "./playback/usePlayback";
import { NavDropdown } from "./components/NavDropdown";
import { sessionFor } from "./editor/session";
import { isProjectPath, projectHasChanges, discardProjectChanges } from "../../shared/project";
import { usePersistence } from "./editor/persistence";
import { useFrameBoundaries } from "./editor/frameBoundaries";
import { useAppearance } from "./lib/appearance";
import { useDesktopLifecycle } from "./lib/desktopLifecycle";
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { MediaSource, ExportJob, SavedSession } from "../../shared/types";
import { primaryVideo } from "../../shared/media";
import { defaultPreferences } from "../../shared/defaults";
import { clamp } from "../../shared/time";
import { adjacentBoundary, neighboringKeyframe, resolveBoundary, splitTargetAt } from "./editor/navigation";
import { resolveAudioSelection } from "./playback/audioSelection";
import { nativeAudioCodecs } from "./playback/codecs";
import { nextKeptTime } from "./playback/ranges";
import {
   ClipPriority,
   mergePair,
   mergeClips,
   addGap,
   canSplit,
   deleteClip,
   editorReducer,
   emptyEditor,
   gapAt,
   minClipLength,
   newDocument,
   selectedClip,
   splitClip,
   trimClip,
} from "./editor/model";
import type { EditDocument } from "./editor/model";
import { CommandContext, guardCommands, resolvedCommand, useCommands } from "./editor/commands";
import type { CommandId, Commands } from "./editor/commands";
import { Button, Modal } from "./components/Controls";
import { Player } from "./components/Player";
import { Timeline } from "./components/Timeline";
import { Transport } from "./components/Transport";
import { LoadingEditor } from "./components/LoadingEditor";
import { TopActions } from "./components/TopActions";
import { AppUpdate } from "./components/AppUpdate";
import { JobNotifications } from "./components/JobNotifications";
import { EmptyState } from "./components/EmptyState";
import type { ExportDraft } from "./export/useExport";
import type { HelpTab } from "./components/HelpPanel";
import { prefetchModules } from "./lib/prefetch";
import { useKeyframes } from "./lib/keyframes";
import { useTemporarySnapping } from "./lib/temporarySnapping";
import { errorText } from "./lib/errors";
import { useExitValue, usePressFeedback } from "./lib/motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faScissors, faFolderOpen, faMinus, faSquare, faXmark, faCircleExclamation, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";

const loadFramePanel = () => import("./components/FramePanel").then((module) => ({ default: module.FramePanel }));
const FramePanel = lazy(loadFramePanel);
const loadExportPanel = () => import("./components/ExportPanel").then((module) => ({ default: module.ExportPanel }));
const ExportPanel = lazy(loadExportPanel);
const loadSettingsPanel = () => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel }));
const SettingsPanel = lazy(loadSettingsPanel);
const loadHelpPanel = () => import("./components/HelpPanel").then((module) => ({ default: module.HelpPanel }));
const HelpPanel = lazy(loadHelpPanel);
const loadAboutPanel = () => import("./components/AboutPanel").then((module) => ({ default: module.AboutPanel }));
const AboutPanel = lazy(loadAboutPanel);

type Panel = "export" | "frame" | "settings" | "shortcuts" | "help" | "about" | null;

const releasesUrl = "https://github.com/NoomStuff/AttaCut/releases";

export default function App() {
   useEffect(() => {
      performance.mark("attacut:editor-commit");
      performance.clearMarks("attacut:editor-commit");
   });
   usePressFeedback();
   const [source, setSource] = useState<MediaSource | null>(null);
   const [editor, dispatch] = useReducer(editorReducer, emptyEditor);
   const [preferences, setPreferences] = useState(defaultPreferences);
   const [ready, setReady] = useState(false);
   const [platform, setPlatform] = useState("win32");
   const [version, setVersion] = useState("");
   const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);
   const [panel, setPanel] = useState<Panel>(null);
   const [helpTab, setHelpTab] = useState<HelpTab>("intro");
   const [exportHelp, setExportHelp] = useState(false);
   const [menu, setMenu] = useState<string | null>(null);
   const [confirmReset, setConfirmReset] = useState(false);
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<{ text: string; tone: "error" | "warning" } | null>(null);
   /** Errors interrupt work and deserve the red banner; warnings only explain a recoverable state. */
   const showError = useCallback((message: string | null) => setError(message === null ? null : { text: message, tone: "error" }), []);
   const [restore, setRestore] = useState<SavedSession | null>(null);
   const [project, setProject] = useState<SavedSession["project"]>();
   const projectRef = useRef(project);
   projectRef.current = project;
   const [savingProject, setSavingProject] = useState(false);
   const savingRef = useRef(false);
   const pendingProjectSave = useRef<Promise<boolean> | null>(null);
   const projectSession = sessionFor(source, editor, null, project);
   const projectDirty = projectSession ? projectHasChanges(projectSession) : false;
   const projectName = project?.path.replaceAll("\\", "/").split("/").at(-1);
   useEffect(() => {
      const name = projectName ?? source?.name;
      void window.desktop.setWindowTitle(name ? `${projectDirty ? "* " : ""}${name} - AttaCut` : "AttaCut").catch(() => {});
   }, [source, projectName, projectDirty]);
   const {
      playing,
      setPlaying,
      muted,
      setMuted,
      playback,
      playbackState,
      url,
      preparing,
      playWhenReady,
      waitForPlay,
      audioIndices,
      setAudioIndices,
      videoRef,
      clock,
      seeker,
      scrubber,
      preparePreview,
      changeAudio,
   } = usePlayback({ source, preferences, setPreferences, setError: showError });
   const [job, setJob] = useState<ExportJob | null>(null);
   const [notifications, setNotifications] = useState<ExportJob[]>([]);
   const receiveJob = useCallback((updated: ExportJob, starting = false) => {
      // Progress can finish before startExport returns. Do not put that finished job back into running state.
      setJob((current) => (starting && current?.id === updated.id && !current.running ? current : updated));
      setNotifications((current) => {
         const existing = current.find((item) => item.id === updated.id);
         if (starting && existing && !existing.running) return current;
         return existing ? current.map((item) => (item.id === updated.id ? updated : item)) : [updated, ...current];
      });
   }, []);
   const [fitToken, setFitToken] = useState(0);
   const [zoomRequest, setZoomRequest] = useState({ id: 0, direction: 0 });
   const [zoom, setZoom] = useState(100);
   const temporarySnapping = useTemporarySnapping(!!panel || loading || !source, preferences.holdToSnap);
   const snapping = preferences.snapping || temporarySnapping;
   const [draggingFile, setDraggingFile] = useState(false);
   const [trimAnimating, setTrimAnimating] = useState(false);
   const trimTimer = useRef(0);
   useEffect(() => () => window.clearTimeout(trimTimer.current), []);
   const [trimming, setTrimmingState] = useState(false);
   // A pure bounds edit animates the clip to its new shape, undo and redo included, so a
   // trimmed edge visibly travels back. Structural edits (split, merge, add, delete) keep
   // their own presence animations: gliding bounds would fight the seam and enter/exit cues.
   const sameClipIds = (a: EditDocument, b: EditDocument) =>
      a.clips.length === b.clips.length && a.clips.every((clip, index) => clip.id === b.clips[index]?.id);
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
   const openSequence = useRef(0);
   const replacingSourceId = useRef<string | null>(null);
   const sourceRef = useRef(source);
   sourceRef.current = source;
   const documentRef = useRef(editor.document);
   documentRef.current = editor.document;
   const mac = platform === "darwin";
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
   const activeDocument = { ...editor.document, selectedId: clip?.id ?? null };
   const commit = (document: EditDocument, group?: string) => {
      remember(selectedClip(document));
      dispatch({ type: "commit", document, ...(group ? { group } : {}) });
   };
   const seek = (time: number, preservePriority = false, glide = false, side?: "start" | "end") => {
      if (!source) return;
      const target = clamp(time, 0, source.duration);
      if (!trimmingRef.current && !preservePriority) {
         priority.move(editor.document, target);
         refreshPriority();
      }
      playback.previewEnd = null;
      seeker.seek(target, preferences.keepPlaying, glide, side ? (side === "end" ? -1 : 0) : undefined);
      // Scrub bursts only belong to paused seeking; playing video provides its own audio.
      if (videoRef.current?.paused && preferences.audioScrub) scrubber.scrub(target, muted ? 0 : preferences.volume, side);
   };
   const fullscreen = () => {
      const action = document.fullscreenElement ? document.exitFullscreen() : videoRef.current?.requestFullscreen();
      void action?.catch((value) => showError(errorText(value)));
   };
   // Saved eagerly here, and again on every change by the effect in usePersistence: this
   // call flushes the outgoing source's session before another one loads, so restoring
   // always sees the latest edit.
   const saveCurrent = async () => {
      const snapshot = sessionFor(source, editor, null, projectRef.current);
      if (snapshot) await window.desktop.saveSession(snapshot);
   };
   const saveProjectSnapshot = async (saveAs = false): Promise<boolean> => {
      const snapshot = sessionFor(source, editor, null, project);
      if (!snapshot || savingRef.current) return false;
      savingRef.current = true;
      setSavingProject(true);
      try {
         const saved = await window.desktop.saveProject(snapshot, saveAs);
         if (!saved) return false;
         if (sourceRef.current?.id === source?.id) {
            await window.desktop.saveSession(saved);
            flushSync(() => {
               setProject(saved.project);
               setSavingProject(false);
            });
         }
         return true;
      } catch (value) {
         showError(errorText(value));
         return false;
      } finally {
         savingRef.current = false;
         setSavingProject(false);
      }
   };
   const saveProject = (saveAs = false): Promise<boolean> => {
      if (pendingProjectSave.current) return Promise.resolve(false);
      const saving = saveProjectSnapshot(saveAs);
      pendingProjectSave.current = saving;
      void saving.finally(() => {
         pendingProjectSave.current = null;
      });
      return saving;
   };
   const confirmProject = async (): Promise<boolean> => {
      if (savingRef.current) return false;
      const snapshot = sessionFor(source, editor, null, project);
      if (!snapshot || !projectHasChanges(snapshot)) return true;
      try {
         const decision = await window.desktop.confirmProject(snapshot);
         return decision === "save" ? saveProject() : decision === "discard";
      } catch (value) {
         showError(errorText(value));
         return false;
      }
   };
   const openPath = async (path: string, saved?: SavedSession, playbackAudio = preferences.playbackAudio, confirm = true) => {
      if (confirm && !(await confirmProject())) return;
      const sequence = ++openSequence.current;
      playback.invalidate();
      setLoading(true);
      setError(null);
      setMenu(null);
      setPanel(null);
      setExportHelp(false);
      scrubber.stop();
      try {
         await saveCurrent();
         if (sequence !== openSequence.current) return;
         const loaded = isProjectPath(path) ? await window.desktop.openProject(path) : null;
         if (isProjectPath(path) && !loaded) return;
         const media = loaded?.source ?? (await window.desktop.openSource(path));
         saved = loaded?.session ?? saved;
         if (sequence !== openSequence.current) return;
         const validSaved =
            saved && saved.size === media.size && saved.modified === media.modified && saved.clips.every((item) => item.end <= media.duration)
               ? saved
               : undefined;
         if (saved && !validSaved) setError({ text: "The original file was changed. Your timeline was reset.", tone: "warning" });
         videoRef.current?.pause();
         scrubber.reset();
         setSource(media);
         setProject(validSaved?.project);
         sourceRef.current = media;
         seeker.configure((time, direction) => {
            const clips = documentRef.current.clips;
            const ending = clips.some((clip) => Math.abs(clip.end - time) < 0.0001);
            const starting = clips.some((clip) => Math.abs(clip.start - time) < 0.0001);
            return window.desktop.frameTime(media.id, time, direction ?? (ending && !starting ? -1 : 0));
         });
         playback.source(media);
         remember(undefined);
         clock.set(0);
         setPlaying(false);
         const sourceAudio = media.streams.filter((stream) => stream.type === "audio");
         const selectedAudio = resolveAudioSelection(sourceAudio, playbackAudio);
         const firstAudio = sourceAudio.find((stream) => selectedAudio.includes(stream.index));
         // Chromium may silently omit an unsupported audio track while playing video.
         const needsAudioPreview = selectedAudio.length > 1 || (!!firstAudio && !nativeAudioCodecs.has(firstAudio.codec));
         setAudioIndices(selectedAudio);
         if (needsAudioPreview) void preparePreview(media, selectedAudio);
         dispatch({
            type: "load",
            document: validSaved ? { clips: validSaved.clips, selectedId: validSaved.selectedId } : newDocument(media.duration),
            past: validSaved ? validSaved.past : [],
            future: validSaved ? validSaved.future : [],
         });
         setFitToken((value) => value + 1);
         setZoomRequest((value) => ({ id: value.id + 1, direction: 0 }));
         setRestore(null);
      } catch (value) {
         if (sequence === openSequence.current) {
            const message = errorText(value);
            const name = path.replaceAll("\\", "/").split("/").at(-1);
            // Expected, recoverable open failures explain themselves with the file's name
            // instead of echoing stat, errno, or ffprobe strings.
            if (/no such file or directory/i.test(message)) {
               setError({ text: `"${name}" was moved or changed and can't be found.`, tone: "warning" });
            } else if (/invalid data found when processing input|moov atom not found|does not contain a video track|no usable video duration/i.test(message)) {
               setError({
                  text: `"${name}" doesn't look like a working video. It may be damaged, incomplete, or in a format AttaCut can't read.`,
                  tone: "warning",
               });
            } else showError(message);
            if (saved) setRestore(saved);
         }
      } finally {
         if (sequence === openSequence.current) setLoading(false);
      }
   };
   const choose = async (saved?: SavedSession) => {
      try {
         const path = await window.desktop.chooseSource();
         if (path) await openPath(path, saved);
      } catch (value) {
         showError(errorText(value));
      }
   };
   // Back to the start screen. The saved session stays on disk, so the next launch restores
   // the project like any other quit; closing only clears the workspace.
   const closeProject = (keepRecovery = true) => {
      // Invalidate any in-flight open so it cannot repopulate the workspace after the close.
      openSequence.current++;
      playback.invalidate();
      setMenu(null);
      setPanel(null);
      setExportHelp(false);
      setError(null);
      const snapshot = sessionFor(source, editor, restore, projectRef.current);
      setRestore(keepRecovery && snapshot ? discardProjectChanges(snapshot) : null);
      setProject(undefined);
      void window.desktop.closeSource().catch((value) => showError(errorText(value)));
      setLoading(false);
      videoRef.current?.pause();
      scrubber.stop();
      scrubber.reset();
      setSource(null);
      sourceRef.current = null;
      remember(undefined);
      clock.set(0);
      setPlaying(false);
      dispatch({ type: "load", document: { clips: [], selectedId: null } });
      void window.desktop.setWindowTitle("AttaCut").catch(() => {});
   };
   // The reset IPC runs before any teardown: if it failed midway, the workspace must not
   // already be cleared, or the start screen would claim a reset that never happened.
   const factoryReset = async () => {
      setConfirmReset(false);
      try {
         await window.desktop.factoryReset();
      } catch (value) {
         showError(errorText(value));
         return;
      }
      closeProject(false);
      setPreferences(defaultPreferences);
   };
   useEffect(() => {
      if (!ready || loading || preparing) return;
      return prefetchModules([loadExportPanel, loadSettingsPanel, loadFramePanel, loadHelpPanel, loadAboutPanel]);
   }, [ready, loading, preparing]);
   const { keyframes, reading: readingKeys } = useKeyframes({ source, snapping, loading, preparing, videoRef, onError: showError });
   useDesktopLifecycle({
      onBootstrap: async (data, signal) => {
         setPreferences(data.preferences);
         setPlatform(data.platform);
         setVersion(data.version);
         setRestore(data.session);
         setReady(true);
         if (data.initialFile) await openPath(data.initialFile, undefined, data.preferences.playbackAudio, false);
         else if (data.session) await openPath(data.session.path, data.session, data.preferences.playbackAudio, false);
         if (!signal.aborted && data.warning) {
            const warning = data.warning;
            setError((current) => current ?? { text: warning, tone: "error" });
         }
      },
      onError: (value) => {
         setReady(true);
         showError(errorText(value));
      },
      onJob: (updated) => {
         receiveJob(updated);
         if (!updated.running && updated.items.some((item) => item.status === "completed"))
            setPreferences((current) => ({ ...current, outputDirectory: updated.directory }));
         if (updated.running || !updated.replacesSource || updated.sourceId !== replacingSourceId.current) return;
         replacingSourceId.current = null;
         const current = sourceRef.current;
         if (!current || current.id !== updated.sourceId) return;
         if (updated.items.some((item) => item.status === "completed" && item.outputPath === current.path))
            void openPath(current.path, undefined, preferences.playbackAudio, false);
         else playback.source(current);
      },
      onOpenFile: (path) => {
         void openPath(path);
      },
   });
   usePersistence({ source, editor, restore, project, pendingProjectSave, preferences, ready, setError: showError });
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
      [clock, seeker, videoRef]
   );
   useFrameBoundaries(source, editor.document, dispatch, showError, alignResolvedBoundary);
   useAppearance(preferences);
   useEffect(() => {
      if (!menu) return;
      const close = (event: PointerEvent) => {
         if (!(event.target instanceof Element && event.target.closest("[data-menu]"))) setMenu(null);
      };
      const escape = (event: KeyboardEvent) => {
         if (event.key === "Escape") setMenu(null);
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", escape);
      return () => {
         window.removeEventListener("pointerdown", close);
         window.removeEventListener("keydown", escape);
      };
   }, [menu]);
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
   const minimumClipLength = () => minClipLength(frameStep);
   const available = () => !!source && !loading && !trimmingRef.current;
   const frameStep = 1 / ((source && primaryVideo(source)?.frameRate) || 100);
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
            if (sequence === frameSequence.current && sourceRef.current?.id === id) seek(target, false, false, "start");
         })
         .catch((value: unknown) => {
            if (sourceRef.current?.id === id) showError(errorText(value));
         });
   };
   const joinAtPlayhead = () => mergePair(editor.document, clock.get(), frameStep, frameStep / 2);
   const onZoomReport = useCallback((percent: number) => setZoom(percent), []);
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
            setPanel("export");
         },
      },
      play: { enabled: available, run: togglePlay },
      frame: {
         enabled: available,
         run: () => {
            videoRef.current?.pause();
            setPanel("frame");
         },
      },
      preview: {
         enabled: () => available() && !!clip,
         run: () => {
            if (!clip || !videoRef.current) return;
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
         if (!available() || (snapping && readingKeys)) return;
         const target = currentClip();
         if (!target) return;
         const current = clock.get();
         const time = splitTargetAt(editor.document, target.id, current, { snapping, keyframes });
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
         if (!gap || gap.end - gap.start < minimumClipLength()) return;
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
      fit: { enabled: available, run: () => setFitToken((value) => value + 1) },
      zoomIn: { enabled: available, run: () => setZoomRequest((value) => ({ id: value.id + 1, direction: 1 })) },
      zoomOut: { enabled: available, run: () => setZoomRequest((value) => ({ id: value.id + 1, direction: -1 })) },
      settings: { enabled: () => ready, run: () => setPanel("settings") },
      shortcuts: { enabled: () => ready, run: () => setPanel("shortcuts") },
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
      reset: { enabled: () => ready, run: () => setConfirmReset(true) },
      help: {
         enabled: () => ready,
         run: () => {
            setHelpTab("intro");
            setPanel("help");
         },
      },
      about: { enabled: () => ready, run: () => setPanel("about") },
   });
   // Panel dialogs guard themselves: the command handler checks the live dialog state, so the
   // panel's exit fade never blocks shortcuts. Only the menu needs the React-side flag.
   useCommands(
      commands,
      preferences.shortcuts,
      mac,
      !!menu,
      preferences.holdToSnap === "none" ? false : preferences.holdToSnap === "Control" ? (mac ? "Ctrl" : "Mod") : preferences.holdToSnap
   );
   const menuSections: Record<string, CommandId[][]> = {
      File: [["open"], ["frame", "export"], ["saveProject", "saveProjectAs", "closeProject"], ["quit"]],
      Edit: [["undo", "redo"], ["split", "merge"], ["setStart", "setEnd", "add", "delete"], ["preview"], ["settings"]],
      View: [["zoomIn", "zoomOut", "fit"]],
      Help: [["help", "shortcuts"], ["releases", "about"], ["reset"]],
   };
   const errorPresence = useExitValue(error, 190);
   return (
      <CommandContext.Provider value={{ commands, overrides: preferences.shortcuts, mac, holdToSnap: preferences.holdToSnap }}>
         <div
            className={`app-shell ${draggingFile ? "file-over" : ""}`}
            onDragOver={(event) => {
               event.preventDefault();
               setDraggingFile(true);
            }}
            onDragLeave={(event) => {
               if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false);
            }}
            onDrop={(event) => {
               event.preventDefault();
               setDraggingFile(false);
               const file = event.dataTransfer.files[0];
               if (file) {
                  const path = window.desktop.filePath(file);
                  if (path) void openPath(path);
               }
            }}
         >
            <div className={`titlebar ${mac ? "mac" : ""}`}>
               <div className="app-mark">
                  <FontAwesomeIcon icon={faScissors} />
               </div>
               <span className="app-name">AttaCut</span>
               <span className="title-separator">/</span>
               <span className="title-filename" title={projectDirty ? "Unsaved project changes" : project?.path}>
                  {projectDirty ? "* " : ""}
                  {projectName ?? source?.name ?? "New cut"}
               </span>
               <AppUpdate ready={ready} onError={showError} />
               {!mac && (
                  <div className="window-controls">
                     <button aria-label="Minimize window" onClick={() => window.desktop.windowAction("minimize")}>
                        <FontAwesomeIcon icon={faMinus} />
                     </button>
                     <button aria-label="Maximize window" onClick={() => window.desktop.windowAction("maximize")}>
                        <FontAwesomeIcon icon={faSquare} />
                     </button>
                     <button aria-label="Close window" onClick={() => window.desktop.windowAction("close")}>
                        <FontAwesomeIcon icon={faXmark} />
                     </button>
                  </div>
               )}
            </div>
            <header className="toolbar">
               <nav aria-label="Application menu">
                  {Object.entries(menuSections).map(([name, sections]) => (
                     <div className="app-menu" key={name} data-menu>
                        <button
                           aria-haspopup="menu"
                           aria-expanded={menu === name}
                           onClick={() => setMenu(menu === name ? null : name)}
                           onKeyDown={(event) => {
                              if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
                              event.preventDefault();
                              setMenu(name);
                              const parent = event.currentTarget.parentElement;
                              const last = event.key === "ArrowUp";
                              requestAnimationFrame(() => {
                                 const items = parent?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
                                 if (items?.length) items[last ? items.length - 1 : 0]?.focus();
                              });
                           }}
                        >
                           {name}
                        </button>
                        <NavDropdown
                           clock={clock}
                           open={menu === name}
                           sections={sections}
                           commands={commands}
                           shortcuts={preferences.shortcuts}
                           mac={mac}
                           close={() => setMenu(null)}
                        />
                     </div>
                  ))}
               </nav>
               <TopActions commands={commands} clock={clock} />
            </header>
            {errorPresence.mounted && errorPresence.value && (
               <div className={`error-wrap${errorPresence.closing ? " closing" : ""}`}>
                  <div
                     className={`error-banner${errorPresence.value.tone === "warning" ? " warning" : ""}`}
                     role={errorPresence.value.tone === "warning" ? "status" : "alert"}
                  >
                     <FontAwesomeIcon icon={errorPresence.value.tone === "warning" ? faTriangleExclamation : faCircleExclamation} />
                     <span>{errorPresence.value.text}</span>
                     {restore && (
                        <Button
                           onClick={() => {
                              void choose(restore);
                           }}
                        >
                           Locate video
                        </Button>
                     )}
                     <button aria-label="Dismiss error" onClick={() => setError(null)}>
                        <FontAwesomeIcon icon={faXmark} />
                     </button>
                  </div>
               </div>
            )}
            <main className="workspace">
               <div className="preview-workspace">
                  {source ? (
                     <Player
                        key={source.id}
                        source={source}
                        seeker={seeker}
                        onFullscreen={fullscreen}
                        url={url}
                        videoRef={videoRef}
                        playback={playback}
                        clock={clock}
                        clips={editor.document.clips}
                        keptOnly={preferences.keptOnly}
                        volume={preferences.volume}
                        muted={muted}
                        audioIndices={audioIndices}
                        onPlaying={(value) => {
                           setPlaying(value);
                           // Real playback replaces any scrub burst still sounding.
                           if (value) {
                              scrubber.stop();
                           }
                        }}
                        onAudioFallback={() => void preparePreview(source, audioIndices, playback.get().transcode, playback.get().intent !== "paused")}
                        onFailure={() => {
                           if (!source) return;
                           const requested = playback.get().intent !== "paused";
                           if (requested) playback.request(true);
                           if (playback.get().transcode) {
                              playback.fail();
                              showError("This video could not be played, but it can still be exported.");
                              return;
                           }
                           void preparePreview(source, audioIndices, true, requested);
                        }}
                        playWhenReady={playWhenReady}
                        waitForPlay={waitForPlay}
                        preparing={preparing}
                        failed={playbackState.phase === "failed"}
                        trimming={trimming}
                     />
                  ) : (
                     <EmptyState onImport={() => void choose()} loading={loading} mac={mac} />
                  )}
                  <JobNotifications
                     onReopen={() => void choose()}
                     jobs={notifications}
                     currentJob={job}
                     onDismiss={(id) => setNotifications((current) => current.filter((item) => item.id !== id))}
                     onError={showError}
                     onRetry={receiveJob}
                  />
               </div>
               {source && (
                  <div className={`editor-dock${trimAnimating ? " trim-animating" : ""}`}>
                     <Timeline
                        key={source.id}
                        document={activeDocument}
                        duration={source.duration}
                        frameStep={frameStep}
                        clock={clock}
                        fitToken={fitToken}
                        zoomRequest={zoomRequest}
                        onZoom={onZoomReport}
                        keyframes={keyframes}
                        snapping={snapping}
                        playing={playing || playWhenReady}
                        onSelect={(id) => remember(editor.document.clips.find((item) => item.id === id))}
                        onCommit={commit}
                        onSeek={seek}
                        onTrimming={setTrimming}
                     />
                     <Transport
                        document={activeDocument}
                        source={source}
                        clock={clock}
                        playing={playing}
                        volume={preferences.volume}
                        muted={muted}
                        audioIndices={audioIndices}
                        onAudio={changeAudio}
                        onVolume={(volume, restore) => {
                           setMuted(volume === 0);
                           setPreferences({ ...preferences, volume: volume === 0 ? restore : volume });
                        }}
                        onBoundary={setBoundary}
                        onFullscreen={fullscreen}
                        zoom={zoom}
                        snapping={snapping}
                        readingKeys={readingKeys}
                     />
                  </div>
               )}
               {(loading || !ready) && (
                  <div className="loading-overlay" role="status" aria-label={loading ? "Opening video" : "Starting"}>
                     <LoadingEditor label={loading ? "Opening..." : "Starting..."} />
                  </div>
               )}
            </main>
            <Suspense
               key={panel}
               fallback={
                  <div className="panel-loading" role="status">
                     Opening panel...
                  </div>
               }
            >
               {panel === "export" && source && (
                  <ExportPanel
                     draft={exportDraft}
                     onDraft={setExportDraft}
                     source={source}
                     clips={editor.document.clips}
                     preferences={preferences}
                     onPreferences={setPreferences}
                     onClose={() => setPanel((current) => (current === panel ? null : current))}
                     onStarted={(started) => receiveJob(started, true)}
                     onBeforeSourceReplace={async () => {
                        replacingSourceId.current = source.id;
                        playback.suspend();
                        scrubber.stop();
                        await Promise.all([window.desktop.cancelPreview(), window.desktop.cancelScrub()]);
                        const video = videoRef.current;
                        video?.pause();
                        video?.removeAttribute("src");
                        video?.load();
                        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                     }}
                     onSourceReplaceStartFailed={() => {
                        replacingSourceId.current = null;
                        playback.source(source);
                     }}
                     onHelp={(topic) => {
                        setHelpTab(topic);
                        setExportHelp(true);
                     }}
                  />
               )}
               {panel === "frame" && source && (
                  <FramePanel
                     source={source}
                     videoRef={videoRef}
                     time={
                        seeker.pending || videoRef.current?.seeking
                           ? clock.getFrame()
                           : ((videoRef.current && clock.getDisplayed(videoRef.current.currentSrc)) ?? videoRef.current?.currentTime ?? clock.get())
                     }
                     preferences={preferences}
                     onPreferences={setPreferences}
                     onClose={() => setPanel((current) => (current === panel ? null : current))}
                  />
               )}
               {(panel === "settings" || panel === "shortcuts") && (
                  <SettingsPanel
                     preferences={preferences}
                     onChange={setPreferences}
                     onClose={() => setPanel((current) => (current === panel ? null : current))}
                     mac={mac}
                     initialTab={panel === "shortcuts" ? "shortcuts" : "general"}
                  />
               )}
               {(panel === "help" || (panel === "export" && exportHelp)) && (
                  <HelpPanel
                     initialTab={helpTab}
                     onClose={() => {
                        if (exportHelp) setExportHelp(false);
                        else setPanel((current) => (current === "help" ? null : current));
                     }}
                  />
               )}
               {panel === "about" && <AboutPanel version={version} onClose={() => setPanel((current) => (current === panel ? null : current))} />}
            </Suspense>
            {confirmReset && (
               <Modal title="Reset AttaCut?" onClose={() => setConfirmReset(false)} className="reset-confirm">
                  <div className="modal-body">Preferences and the saved editing session return to factory defaults. Your video files are not touched.</div>
                  <div className="modal-footer">
                     <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
                     <Button
                        variant="danger"
                        onClick={() => {
                           void factoryReset();
                        }}
                     >
                        Reset
                     </Button>
                  </div>
               </Modal>
            )}
            {draggingFile && (
               <div className="drop-overlay">
                  <FontAwesomeIcon icon={faFolderOpen} />
                  <span>Drop to open a video or project</span>
               </div>
            )}
         </div>
      </CommandContext.Provider>
   );
}
