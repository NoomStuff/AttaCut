import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { AvailableUpdate, MediaSource, ExportJob, SavedSession, Preferences } from "../../shared/types";
import { clipColorCount, defaultPreferences } from "../../shared/defaults";
import { clamp } from "../../shared/time";
import { adjacentBoundary, resolveBoundary, splitTargetAt } from "./editor/navigation";
import { selectNativeAudio } from "./playback/audio";
import { rememberAudioSelection, resolveAudioSelection } from "./playback/audioSelection";
import { nativeAudioCodecs } from "./playback/codecs";
import { PlaybackSeeker } from "./playback/seeker";
import { AudioScrubber } from "./playback/scrubber";
import { PlaybackController } from "./playback/controller";
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
import type { EditDocument, EditorState } from "./editor/model";
import { CommandContext, resolvedCommand, bindingsFor, commandDefinitions, displayBindings, useCommands } from "./editor/commands";
import type { CommandId, Commands } from "./editor/commands";
import { PlaybackClock, useClock } from "./playback/clock";
import { Button } from "./components/Controls";
import { Player } from "./components/Player";
import { Timeline } from "./components/Timeline";
import { Transport } from "./components/Transport";
import { LoadingEditor } from "./components/LoadingEditor";
import { TopActions } from "./components/TopActions";
import { JobProgress } from "./components/JobProgress";
import { EmptyState } from "./components/EmptyState";
import type { ExportDraft } from "./components/ExportPanel";
import type { HelpTab } from "./components/HelpPanel";
import { prefetchModules } from "./lib/prefetch";
import { useKeyframes } from "./lib/keyframes";
import { errorText, isCancellation } from "./lib/errors";
import { useExitValue, usePressFeedback } from "./lib/motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faScissors, faFolderOpen, faMinus, faSquare, faXmark, faCircleExclamation } from "@fortawesome/free-solid-svg-icons";

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
const loadUpdatePanel = () => import("./components/UpdatePanel").then((module) => ({ default: module.UpdatePanel }));
const UpdatePanel = lazy(loadUpdatePanel);

type Panel = "export" | "frame" | "settings" | "shortcuts" | "help" | "about" | null;

/** One construction of the persisted session; adding a field to SavedSession edits this once. */
function sessionFor(source: MediaSource | null, editor: EditorState, restore: SavedSession | null): SavedSession | null {
   if (!source) return restore;
   return {
      path: source.path,
      size: source.size,
      modified: source.modified,
      clips: editor.document.clips,
      selectedId: editor.document.selectedId,
      past: editor.past,
      future: editor.future,
   };
}

function NavDropdown({
   clock,
   open,
   ids,
   commands,
   shortcuts,
   mac,
   close,
}: {
   clock: PlaybackClock;
   open: boolean;
   ids: CommandId[];
   commands: Commands;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   close: () => void;
}) {
   const presence = useExitValue(open ? true : null, 120);
   if (!presence.mounted) return null;
   return <NavDropdownItems clock={clock} closing={presence.closing} ids={ids} commands={commands} shortcuts={shortcuts} mac={mac} close={close} />;
}

function NavDropdownItems({
   clock,
   closing,
   ids,
   commands,
   shortcuts,
   mac,
   close,
}: {
   clock: PlaybackClock;
   closing: boolean;
   ids: CommandId[];
   commands: Commands;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   close: () => void;
}) {
   // Subscribed only while mounted, so closed menus never tick with the clock.
   useClock(clock);
   return (
      <div className={`dropdown${closing ? " closing" : ""}`} role="menu">
         {ids.map((id) => (
            <button
               role="menuitem"
               key={id}
               disabled={!commands[id].enabled()}
               onClick={() => {
                  close();
                  commands[id].run();
               }}
            >
               <span>{commandDefinitions[id].label}</span>
               <kbd>{displayBindings(bindingsFor(id, shortcuts), mac)}</kbd>
            </button>
         ))}
      </div>
   );
}

export default function App() {
   usePressFeedback();
   const [source, setSource] = useState<MediaSource | null>(null);
   const [editor, dispatch] = useReducer(editorReducer, emptyEditor);
   const [preferences, setPreferences] = useState(defaultPreferences);
   const [ready, setReady] = useState(false);
   const [platform, setPlatform] = useState("win32");
   const [version, setVersion] = useState("");
   const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
   const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);
   const [panel, setPanel] = useState<Panel>(null);
   const [helpTab, setHelpTab] = useState<HelpTab>("intro");
   const [menu, setMenu] = useState<string | null>(null);
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [restore, setRestore] = useState<SavedSession | null>(null);
   const [playing, setPlaying] = useState(false);
   const [muted, setMuted] = useState(false);
   const [playback] = useState(() => new PlaybackController());
   const playbackState = useSyncExternalStore(playback.subscribe, playback.get);
   const { url } = playbackState;
   const preparing = playbackState.phase === "preparing";
   const playWhenReady = playbackState.intent === "requested";
   const waitForPlay = playbackState.showWait;
   const [audioIndices, setAudioIndices] = useState<number[]>([]);
   const [job, setJob] = useState<ExportJob | null>(null);
   const [fitToken, setFitToken] = useState(0);
   const [zoomRequest, setZoomRequest] = useState({ id: 0, direction: 0 });
   const [zoom, setZoom] = useState(100);
   // Reported by the Timeline with the zoom percentage; read when merge evaluates, so a
   // viewport resize between renders still yields a current seam tolerance.
   const viewportWidth = useRef(0);
   const snapping = preferences.snapping;
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
   const videoRef = useRef<HTMLVideoElement>(null);
   const trimmingRef = useRef(false);
   const setTrimming = (active: boolean) => {
      trimmingRef.current = active;
      setTrimmingState(active);
   };
   const [clock] = useState(() => new PlaybackClock());
   const [seeker] = useState(() => new PlaybackSeeker(clock));
   const [scrubber] = useState(() => new AudioScrubber());
   // Each source/selection owns a small PCM working set. Old identities are cleared immediately.
   useEffect(() => {
      scrubber.configure(
         source && preferences.audioScrub && audioIndices.length > 0 ? (time) => window.desktop.scrubAudio(source.id, audioIndices, time) : null
      );
      return () => {
         scrubber.reset();
         void window.desktop.cancelScrub();
      };
   }, [source, audioIndices, preferences.audioScrub, scrubber]);
   useEffect(() => () => scrubber.dispose(), [scrubber]);
   const openSequence = useRef(0);
   const replacingSourceId = useRef<string | null>(null);
   const sourceRef = useRef(source);
   sourceRef.current = source;
   const requestPlayback = (showWait: boolean) => playback.request(showWait);
   const clearPlaybackRequest = () => playback.pause();
   const preparePreview = async (target: MediaSource, tracks: number[], transcode = false, resume = false) => {
      const video = videoRef.current;
      if (resume || (video && !video.paused)) requestPlayback(false);
      video?.pause();
      setError(null);
      try {
         await playback.prepare(
            target.id,
            transcode,
            () => window.desktop.preparePreview(target.id, tracks, transcode),
            () => playback.holdPreviewFrame()
         );
      } catch (value) {
         const message = errorText(value);
         if (!isCancellation(message)) setError(message);
      }
   };
   const mac = platform === "darwin";
   const [priority] = useState(() => new ClipPriority());
   // Time displays subscribe separately. The root only updates when the active clip changes.
   useSyncExternalStore(clock.subscribe, () => priority.resolve(editor.document, clock.get())?.id ?? null);
   const [, refreshPriority] = useReducer((value: number) => value + 1, 0);
   const remember = (clip: ReturnType<typeof selectedClip>) => {
      priority.remember(clip);
      refreshPriority();
   };
   const deleteTarget = () => priority.resolve(editor.document, clock.get(), false);
   const targetClip = () => priority.resolve(editor.document, clock.get());
   const currentClip = () => {
      const target = targetClip();
      return editor.document.clips.find((item) => item.id === target?.id);
   };
   const clip = currentClip();
   const activeDocument = { ...editor.document, selectedId: clip?.id ?? null };
   const commit = (document: EditDocument) => {
      remember(selectedClip(document));
      dispatch({ type: "commit", document });
   };
   const seek = (time: number, preservePriority = false) => {
      if (!source) return;
      const target = clamp(time, 0, source.duration);
      if (!trimmingRef.current && !preservePriority) {
         priority.move(editor.document, target);
         refreshPriority();
      }
      playback.previewEnd = null;
      seeker.seek(target, preferences.keepPlaying);
      // Scrub bursts only belong to paused seeking; playing video provides its own audio.
      if (videoRef.current?.paused && preferences.audioScrub) scrubber.scrub(target, muted ? 0 : preferences.volume);
   };
   const fullscreen = () => {
      const action = document.fullscreenElement ? document.exitFullscreen() : videoRef.current?.requestFullscreen();
      void action?.catch((value) => setError(errorText(value)));
   };
   // Saved eagerly here, and again by the effect below on every change: this call flushes the
   // outgoing source's session before another one loads, so restoring always sees the latest edit.
   const saveCurrent = async () => {
      const snapshot = sessionFor(source, editor, null);
      if (snapshot) await window.desktop.saveSession(snapshot);
   };
   const openPath = async (path: string, saved?: SavedSession, playbackAudio = preferences.playbackAudio) => {
      const sequence = ++openSequence.current;
      playback.invalidate();
      setLoading(true);
      setError(null);
      setMenu(null);
      setPanel(null);
      scrubber.stop();
      try {
         await saveCurrent();
         if (sequence !== openSequence.current) return;
         const media = await window.desktop.openSource(path);
         if (sequence !== openSequence.current) return;
         const validSaved = saved && saved.size === media.size && saved.modified === media.modified && saved.clips.every((item) => item.end <= media.duration);
         if (saved && !validSaved) setError("The original file was changed. Your timeline was reset.");
         videoRef.current?.pause();
         scrubber.reset();
         setSource(media);
         sourceRef.current = media;
         seeker.configure((time) => window.desktop.frameTime(media.id, time, 0));
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
            document: validSaved ? { clips: saved.clips, selectedId: saved.selectedId } : newDocument(media.duration),
            past: validSaved ? saved.past : [],
            future: validSaved ? saved.future : [],
         });
         setFitToken((value) => value + 1);
         setZoomRequest((value) => ({ id: value.id + 1, direction: 0 }));
         setRestore(null);
      } catch (value) {
         if (sequence === openSequence.current) {
            setError(errorText(value));
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
         setError(errorText(value));
      }
   };
   useEffect(() => {
      if (!ready || loading || preparing) return;
      return prefetchModules([loadExportPanel, loadSettingsPanel, loadFramePanel, loadHelpPanel, loadAboutPanel, loadUpdatePanel]);
   }, [ready, loading, preparing]);
   const { keyframes, reading: readingKeys } = useKeyframes({ source, snapping, loading, preparing, videoRef, onError: setError });
   useEffect(() => {
      let cancelled = false;
      void window.desktop
         .bootstrap()
         .then(async (data) => {
            if (cancelled) return;
            setPreferences(data.preferences);
            setPlatform(data.platform);
            setVersion(data.version);
            setRestore(data.session);
            setReady(true);
            void window.desktop
               .checkForUpdate()
               .then((update) => {
                  if (!cancelled) setAvailableUpdate(update);
               })
               .catch(() => {});
            if (data.initialFile) await openPath(data.initialFile, undefined, data.preferences.playbackAudio);
            else if (data.session) await openPath(data.session.path, data.session, data.preferences.playbackAudio);
            if (!cancelled && data.warning) setError((current) => current ?? data.warning);
         })
         .catch((value: unknown) => {
            setReady(true);
            setError(errorText(value));
         });
      const unsubscribe = window.desktop.onJob((updated) => {
         setJob(updated);
         if (!updated.running && updated.items.some((item) => item.status === "completed"))
            setPreferences((current) => ({ ...current, outputDirectory: updated.directory }));
         if (updated.running || !updated.replacesSource || updated.sourceId !== replacingSourceId.current) return;
         replacingSourceId.current = null;
         const current = sourceRef.current;
         if (!current || current.id !== updated.sourceId) return;
         if (updated.items.some((item) => item.status === "completed" && item.outputPath === current.path)) void openLatest.current(current.path);
         else playback.source(current);
      });
      return () => {
         cancelled = true;
         unsubscribe();
      };
      // Desktop initialization runs once. Later source changes use explicit open commands.
   }, []);
   const latestSnapshot = useRef({ preferences, session: null as SavedSession | null });
   latestSnapshot.current = { preferences, session: sessionFor(source, editor, restore) };
   const openLatest = useRef(openPath);
   openLatest.current = openPath;
   useEffect(() => {
      const flush = window.desktop.onFlush(() => {
         void window.desktop.flushState(latestSnapshot.current).catch((value: unknown) => setError(errorText(value)));
      });
      const open = window.desktop.onOpenFile((path) => {
         void openLatest.current(path);
      });
      return () => {
         flush();
         open();
      };
   }, []);
   useEffect(() => {
      if (!ready) return;
      const timer = window.setTimeout(() => {
         void window.desktop.savePreferences(preferences).catch((value: unknown) => setError(errorText(value)));
      }, 100);
      return () => window.clearTimeout(timer);
   }, [preferences, ready]);
   useEffect(() => {
      const system = window.matchMedia("(prefers-color-scheme: dark)");
      const applyTheme = () => {
         document.documentElement.dataset["theme"] = preferences.theme === "system" ? (system.matches ? "dark" : "light") : preferences.theme;
      };
      applyTheme();
      system.addEventListener("change", applyTheme);
      return () => system.removeEventListener("change", applyTheme);
   }, [preferences.theme]);
   useEffect(() => {
      document.documentElement.style.setProperty("--accent", `var(--clip-${preferences.accent})`);
      for (let index = 0; index < clipColorCount; index++) {
         document.documentElement.style.setProperty(`--clip-sequence-${index}`, `var(--clip-${(index + preferences.accent) % clipColorCount})`);
      }
   }, [preferences.accent]);
   useEffect(() => {
      if (!source) return;
      const timer = window.setTimeout(() => {
         const snapshot = sessionFor(source, editor, null);
         if (snapshot) void window.desktop.saveSession(snapshot).catch((value: unknown) => setError(errorText(value)));
      }, 100);
      return () => window.clearTimeout(timer);
   }, [source, editor]);
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
         clearPlaybackRequest();
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
      requestPlayback(true);
      if (preparing) return;
      void video.play().catch(() => undefined);
   };
   const selectAdjacent = (direction: -1 | 1) => {
      const time = adjacentBoundary(editor.document.clips, clock.get(), direction);
      if (time !== null) {
         seek(time);
      }
   };
   const setBoundary = (side: "start" | "end", value: number, target = clip) => {
      const clip = target;
      if (source && clip) {
         const time = resolveBoundary(editor.document, clip.id, side, value, {
            duration: source.duration,
            viewLength: (source.duration * 100) / Math.max(1, zoom),
            frameStep,
            snapping,
            keyframes,
         });
         const next = trimClip(editor.document, clip.id, side, time, source.duration);
         const actual = next.clips.find((item) => item.id === clip.id)![side];
         if (actual === clip[side]) return actual;
         animateTrim();
         commit(next);
         seeker.seek(actual, preferences.keepPlaying);
         return actual;
      }
      return value;
   };
   const minimumClipLength = () => minClipLength(0, frameStep);
   const splitTime = () => (clip ? splitTargetAt(editor.document, clip.id, clock.get(), { snapping, keyframes }) : clock.get());
   const available = () => !!source && !loading && !trimmingRef.current;
   const frameStep = 1 / (source?.streams.find((stream) => stream.type === "video")?.frameRate || 100);
   const frameSequence = useRef(0);
   const stepFrame = (direction: -1 | 1) => {
      videoRef.current?.pause();
      playback.previewEnd = null;
      const sequence = ++frameSequence.current;
      const id = source!.id;
      void window.desktop
         .frameTime(id, clock.get(), direction)
         .then((target) => {
            if (sequence === frameSequence.current && sourceRef.current?.id === id) seek(target);
         })
         .catch((value: unknown) => {
            if (sourceRef.current?.id === id) setError(errorText(value));
         });
   };
   const joinAtPlayhead = () =>
      mergePair(
         editor.document,
         clock.get(),
         frameStep,
         // A seam joins when the playhead is within ~12px of it at the current zoom.
         Math.max(frameStep, (((source!.duration * 100) / Math.max(1, zoom)) * 12) / Math.max(1, viewportWidth.current))
      );
   // Stable identity: the Timeline re-reports zoom through an effect keyed on this callback.
   const onZoomReport = useCallback((percent: number, width: number) => {
      setZoom(percent);
      viewportWidth.current = width;
   }, []);
   const commands: Commands = {
      frameBack: { enabled: available, run: () => stepFrame(-1) },
      frameForward: { enabled: available, run: () => stepFrame(1) },
      mute: {
         enabled: available,
         run: () => {
            setMuted(!muted && preferences.volume > 0);
            if (preferences.volume === 0) setPreferences({ ...preferences, volume: 0.7 });
         },
      },
      snap: { enabled: () => available() && !readingKeys, run: () => setPreferences((current) => ({ ...current, snapping: !current.snapping })) },
      merge: {
         enabled: () => available() && joinAtPlayhead() >= 0,
         run: () => {
            const index = joinAtPlayhead();
            if (index < 0) return;
            const boundary = editor.document.clips[index]!.end;
            commit(mergeClips(editor.document, index));
            seek(boundary, true);
         },
      },
      toggleClip: {
         ...resolvedCommand(() => {
            const action = currentClip() ? commands.delete : commands.add;
            return action.enabled() ? action.run : undefined;
         }),
         feedback: () => (currentClip() ? "delete" : "add"),
      },
      open: {
         enabled: () => ready,
         run: () => {
            void choose();
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
            requestPlayback(true);
            if (!preparing) void videoRef.current.play().catch(() => undefined);
         },
      },
      back: { enabled: available, run: () => seek(clock.get() - 1) },
      forward: { enabled: available, run: () => seek(clock.get() + 1) },
      backFast: { enabled: available, run: () => seek(clock.get() - 5) },
      forwardFast: { enabled: available, run: () => seek(clock.get() + 5) },
      previous: {
         enabled: () => available() && adjacentBoundary(editor.document.clips, clock.get(), -1) !== null,
         run: () => selectAdjacent(-1),
      },
      next: {
         enabled: () => available() && adjacentBoundary(editor.document.clips, clock.get(), 1) !== null,
         run: () => selectAdjacent(1),
      },
      split: {
         enabled: () =>
            available() &&
            !!clip &&
            joinAtPlayhead() < 0 &&
            (!snapping || !readingKeys) &&
            canSplit(editor.document, clip.id, clock.get(), minimumClipLength()) &&
            canSplit(editor.document, clip.id, splitTime(), minimumClipLength()),
         run: () => {
            if (!clip) return;
            const time = splitTime();
            const next = splitClip(editor.document, clip.id, time, minimumClipLength());
            commit(next);
            seeker.seek(time, preferences.keepPlaying);
         },
      },
      setStart: {
         enabled: () => available() && !!currentClip() && clock.get() > currentClip()!.start && clock.get() < currentClip()!.end,
         run: () => setBoundary("start", clock.get(), currentClip()),
      },
      setEnd: {
         enabled: () => available() && !!currentClip() && clock.get() > currentClip()!.start && clock.get() < currentClip()!.end,
         run: () => setBoundary("end", clock.get(), currentClip()),
      },
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
      help: {
         enabled: () => ready,
         run: () => {
            setHelpTab("intro");
            setPanel("help");
         },
      },
      about: { enabled: () => ready, run: () => setPanel("about") },
   };
   // Panel dialogs guard themselves: the command handler checks the live dialog state, so the
   // panel's exit fade never blocks shortcuts. Only the menu needs the React-side flag.
   useCommands(commands, preferences.shortcuts, mac, !!menu);
   const menuItems: Record<string, CommandId[]> = {
      File: ["open", "frame", "export"],
      Edit: ["undo", "redo", "settings"],
      Clips: ["merge", "split", "setStart", "setEnd", "add", "delete", "preview"],
      View: ["zoomIn", "zoomOut", "fit", "settings"],
      Help: ["help", "shortcuts", "about"],
   };
   const errorPresence = useExitValue(error, 190);
   const jobPresence = useExitValue(job, 160);
   const changeAudio = (indices: number[]) => {
      scrubber.reset();
      setAudioIndices(indices);
      if (source) {
         const tracks = source.streams.filter((stream) => stream.type === "audio");
         setPreferences((current) => ({ ...current, playbackAudio: rememberAudioSelection(tracks, indices) }));
         const video = videoRef.current;
         if (video && (indices.length !== 1 || !selectNativeAudio(video, source, indices)))
            void preparePreview(source, indices, playback.get().transcode, !video.paused);
      }
   };
   return (
      <CommandContext.Provider value={{ commands, overrides: preferences.shortcuts, mac }}>
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
               <span className="title-filename">{source?.name ?? "New cut"}</span>
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
                  {Object.entries(menuItems).map(([name, ids]) => (
                     <div className="app-menu" key={name} data-menu>
                        <button
                           className={menu === name ? "active" : ""}
                           aria-haspopup="menu"
                           aria-expanded={menu === name}
                           onClick={() => setMenu(menu === name ? null : name)}
                        >
                           {name}
                        </button>
                        <NavDropdown
                           clock={clock}
                           open={menu === name}
                           ids={ids}
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
                  <div className="error-banner" role="alert">
                     <FontAwesomeIcon icon={faCircleExclamation} />
                     <span>{errorPresence.value}</span>
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
               {source ? (
                  <>
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
                           if (!value && playback.get().intent === "playing") playback.pause();
                           // Real playback replaces any scrub burst still sounding.
                           if (value) {
                              playback.playing();
                              scrubber.stop();
                           }
                        }}
                        onFailure={() => {
                           if (!source) return;
                           const requested = playback.get().intent !== "paused";
                           if (requested) requestPlayback(true);
                           if (playback.get().transcode) {
                              playback.fail();
                              setError("This video could not be played, but it can still be exported.");
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
                  </>
               ) : (
                  <EmptyState onImport={() => void choose()} loading={loading} mac={mac} />
               )}
               {(loading || !ready) && (
                  <div className="loading-overlay" role="status" aria-label={loading ? "Opening video" : "Loading editor"}>
                     <LoadingEditor />
                  </div>
               )}
            </main>
            {jobPresence.mounted && jobPresence.value && (
               <JobProgress
                  key={jobPresence.value.id}
                  job={jobPresence.value}
                  closing={jobPresence.closing}
                  onDismiss={() => setJob(null)}
                  onError={(value) => setError(value)}
                  onRetry={setJob}
               />
            )}
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
                     onStarted={(started) => setJob((current) => (current?.id === started.id && !current.running ? current : started))}
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
                        setPanel("help");
                     }}
                  />
               )}
               {panel === "frame" && source && (
                  <FramePanel
                     source={source}
                     time={clock.get()}
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
               {panel === "help" && <HelpPanel initialTab={helpTab} onClose={() => setPanel((current) => (current === panel ? null : current))} />}
               {panel === "about" && <AboutPanel version={version} onClose={() => setPanel((current) => (current === panel ? null : current))} />}
            </Suspense>
            <Suspense fallback={null}>{availableUpdate && <UpdatePanel update={availableUpdate} onClose={() => setAvailableUpdate(null)} />}</Suspense>
            {draggingFile && (
               <div className="drop-overlay">
                  <FontAwesomeIcon icon={faFolderOpen} />
                  <span>Drop to Import video</span>
               </div>
            )}
         </div>
      </CommandContext.Provider>
   );
}
