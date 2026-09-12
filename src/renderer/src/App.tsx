import { useEffect, useReducer, useRef, useState } from "react";
import type { MediaSource, ExportJob, SavedSession, Preferences } from "../../shared/types";
import { defaultPreferences } from "../../shared/types";
import { clamp } from "../../shared/time";
import { adjacentBoundary, snapBoundary } from "./editor/navigation";
import { selectNativeAudio } from "./playback/audio";
import { PlaybackSeeker } from "./playback/seeker";
import { nextKeptTime } from "./playback/ranges";
import { FramePanel } from "./components/FramePanel";
import {
   clipAt,
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
import { CommandContext, bindingsFor, commandDefinitions, displayBindings, useCommands } from "./editor/commands";
import type { CommandId, Commands } from "./editor/commands";
import { PlaybackClock } from "./playback/clock";
import { Button } from "./components/Controls";
import { Player } from "./components/Player";
import { Timeline } from "./components/Timeline";
import { Transport } from "./components/Transport";
import { TopActions } from "./components/TopActions";
import { JobProgress } from "./components/JobProgress";
import { EmptyState } from "./components/EmptyState";
import { ExportPanel } from "./components/ExportPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { errorText } from "./lib/errors";
import { useExitValue, usePressFeedback } from "./lib/motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faScissors, faFolderOpen, faMinus, faSquare, faXmark, faCircleExclamation } from "@fortawesome/free-solid-svg-icons";

type Panel = "export" | "frame" | "settings" | "shortcuts" | null;

function NavDropdown({
   open,
   ids,
   commands,
   shortcuts,
   mac,
   close,
}: {
   open: boolean;
   ids: CommandId[];
   commands: Commands;
   shortcuts: Preferences["shortcuts"];
   mac: boolean;
   close: () => void;
}) {
   const presence = useExitValue(open ? true : null, 120);
   if (!presence.mounted) return null;
   return (
      <div className={`dropdown${presence.closing ? " closing" : ""}`} role="menu">
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
   const [panel, setPanel] = useState<Panel>(null);
   const [menu, setMenu] = useState<string | null>(null);
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [restore, setRestore] = useState<SavedSession | null>(null);
   const [playing, setPlaying] = useState(false);
   const [muted, setMuted] = useState(false);
   const [url, setUrl] = useState("");
   const [previewFailed, setPreviewFailed] = useState(false);
   const [previewNeedsTranscode, setPreviewNeedsTranscode] = useState(false);
   const [preparing, setPreparing] = useState(false);
   const [previewProgress, setPreviewProgress] = useState(0);
   const [audioIndex, setAudioIndex] = useState<number | null>(null);
   const [job, setJob] = useState<ExportJob | null>(null);
   const [fitToken, setFitToken] = useState(0);
   const [zoomRequest, setZoomRequest] = useState({ id: 0, direction: 0 });
   const [zoom, setZoom] = useState(100);
   const [keyframes, setKeyframes] = useState<number[]>([]);
   const [snapping, setSnapping] = useState(false);
   const [readingKeys, setReadingKeys] = useState(false);
   const [draggingFile, setDraggingFile] = useState(false);
   const [trimAnimating, setTrimAnimating] = useState(false);
   const trimTimer = useRef(0);
   useEffect(() => () => window.clearTimeout(trimTimer.current), []);
   const [trimming, setTrimmingState] = useState(false);
   const videoRef = useRef<HTMLVideoElement>(null);
   const previewEnd = useRef<number | null>(null);
   const trimmingRef = useRef(false);
   const setTrimming = (active: boolean) => {
      trimmingRef.current = active;
      setTrimmingState(active);
   };
   // Dragging a handle pins the playhead onto the edited boundary, which would flip playhead-
   // dependent availability on sub-step rounding while the draft is not yet committed. Hold the
   // pre-drag availability until the drag settles.
   const idleAvailability = useRef<Record<string, boolean>>({});
   const frozenAvailability = (key: string, evaluate: () => boolean): boolean => {
      const value = evaluate();
      if (!trimmingRef.current) idleAvailability.current[key] = value;
      return trimmingRef.current ? (idleAvailability.current[key] ?? value) : value;
   };
   const deleteReady = () =>
      frozenAvailability("delete", () => {
         return available() && !!clipAt(editor.document, clock.get());
      });
   const [clock] = useState(() => new PlaybackClock());
   const [seeker] = useState(() => new PlaybackSeeker(clock));
   const openSequence = useRef(0);
   const sourceRef = useRef(source);
   sourceRef.current = source;
   const mac = platform === "darwin";
   const clip = selectedClip(editor.document);
   const commit = (document: EditDocument) => dispatch({ type: "commit", document });
   const seek = (time: number) => {
      if (!source) return;
      const target = clamp(time, 0, source.duration);
      const selected = editor.document.clips.find((item) => target >= item.start && target <= item.end);
      if (selected && !(clip && target >= clip.start && target <= clip.end)) dispatch({ type: "select", id: selected.id });
      previewEnd.current = null;
      seeker.seek(target, preferences.keepPlaying);
   };
   const fullscreen = () => {
      const action = document.fullscreenElement ? document.exitFullscreen() : videoRef.current?.requestFullscreen();
      void action?.catch((value) => setError(errorText(value)));
   };
   // Saved eagerly here, and again by the effect below on every change: this call flushes the
   // outgoing source's session before another one loads, so restoring always sees the latest edit.
   const saveCurrent = async () => {
      if (source)
         await window.desktop.saveSession({
            path: source.path,
            size: source.size,
            modified: source.modified,
            clips: editor.document.clips,
            selectedId: editor.document.selectedId,
         });
   };
   const openPath = async (path: string, saved?: SavedSession) => {
      const sequence = ++openSequence.current;
      setLoading(true);
      setError(null);
      setMenu(null);
      setPanel(null);
      try {
         await saveCurrent();
         const media = await window.desktop.openSource(path);
         if (sequence !== openSequence.current) return;
         const validSaved = saved && saved.size === media.size && saved.modified === media.modified && saved.clips.every((item) => item.end <= media.duration);
         if (saved && !validSaved) setError("The source file changed. Opened it with a fresh selection.");
         videoRef.current?.pause();
         previewEnd.current = null;
         setSource(media);
         setPreferences((current) => ({ ...current, outputDirectory: media.directory }));
         setKeyframes([]);
         setSnapping(false);
         setReadingKeys(false);
         setUrl(media.url);
         clock.set(0);
         setPlaying(false);
         const firstAudio = media.streams.find((stream) => stream.type === "audio");
         // Chromium may silently omit an unsupported audio track while playing video.
         setPreviewFailed(!!firstAudio && !["aac", "mp3", "opus", "vorbis", "flac"].includes(firstAudio.codec));
         setPreviewNeedsTranscode(false);
         setPreparing(false);
         setAudioIndex(media.streams.find((stream) => stream.type === "audio")?.index ?? null);
         dispatch({ type: "load", document: validSaved ? { clips: saved.clips, selectedId: saved.selectedId } : newDocument(media.duration) });
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
      if (!source) return;
      let cancelled = false;
      setReadingKeys(true);
      void window.desktop
         .keyframes(source.id)
         .then((keys) => {
            if (!cancelled) setKeyframes(keys);
         })
         .catch((value) => {
            if (!cancelled) setError(errorText(value));
         })
         .finally(() => {
            if (!cancelled) setReadingKeys(false);
         });
      return () => {
         cancelled = true;
      };
   }, [source]);
   useEffect(() => {
      let cancelled = false;
      void window.desktop
         .bootstrap()
         .then((data) => {
            if (cancelled) return;
            setPreferences(data.preferences);
            setPlatform(data.platform);
            setReady(true);
            if (data.initialFile) void openPath(data.initialFile);
            else if (data.session) void openPath(data.session.path, data.session);
         })
         .catch((value: unknown) => {
            setReady(true);
            setError(errorText(value));
         });
      const unsubscribe = window.desktop.onJob(setJob);
      const unsubscribePreview = window.desktop.onPreview((value) => {
         if (value.sourceId === sourceRef.current?.id) setPreviewProgress(value.progress);
      });
      return () => {
         cancelled = true;
         unsubscribe();
         unsubscribePreview();
      };
      // Desktop initialization runs once. Later source changes use explicit open commands.
   }, []);
   useEffect(() => {
      document.documentElement.dataset["theme"] = preferences.theme;
      if (ready) void window.desktop.savePreferences(preferences).catch((value: unknown) => setError(errorText(value)));
   }, [preferences, ready]);
   useEffect(() => {
      if (source)
         void window.desktop
            .saveSession({
               path: source.path,
               size: source.size,
               modified: source.modified,
               clips: editor.document.clips,
               selectedId: editor.document.selectedId,
            })
            .catch((value: unknown) => setError(errorText(value)));
   }, [source, editor.document]);
   useEffect(() => {
      if (!menu) return;
      const close = (event: PointerEvent) => {
         if (!(event.target instanceof Element && event.target.closest(".app-menu"))) setMenu(null);
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
      previewEnd.current = null;
      if (!video.paused) {
         video.pause();
         return;
      }
      const time = clock.get();
      if (preferences.keptOnly && editor.document.clips.length) {
         seeker.seek(nextKeptTime(editor.document.clips, time) ?? editor.document.clips[0]!.start, true);
      } else if (source && time >= source.duration - 0.02) seeker.seek(0, true);
      void video.play().catch(() => setPreviewFailed(true));
   };
   const selectAdjacent = (direction: -1 | 1) => {
      const time = adjacentBoundary(editor.document.clips, clock.get(), direction);
      if (time !== null) {
         const next =
            direction === 1
               ? (editor.document.clips.find((item) => item.end === time) ?? editor.document.clips.find((item) => item.start === time))
               : (editor.document.clips.find((item) => item.start === time) ?? editor.document.clips.find((item) => item.end === time));
         if (next) dispatch({ type: "select", id: next.id });
         seek(time);
      }
   };
   const setBoundary = (side: "start" | "end", value: number, target = clip) => {
      const clip = target;
      if (source && clip) {
         const frameStep = (() => {
            const rate = source.streams.find((stream) => stream.type === "video")?.frameRate;
            return rate ? 1 / rate : 0.01;
         })();
         const floor = Math.min(clip.end - clip.start, minClipLength((source.duration * 100) / Math.max(1, zoom), frameStep));
         const bounded = side === "start" ? Math.min(value, clip.end - floor) : Math.max(value, clip.start + floor);
         const next = trimClip(
            editor.document,
            clip.id,
            side,
            snapping ? snapBoundary(editor.document, clip.id, side, bounded, keyframes, source.duration) : bounded,
            source.duration,
            floor
         );
         const actual = next.clips.find((item) => item.id === clip.id)![side];
         if (actual === clip[side]) return actual;
         setTrimAnimating(true);
         window.clearTimeout(trimTimer.current);
         trimTimer.current = window.setTimeout(() => setTrimAnimating(false), 180);
         commit(next);
         seek(actual);
         return actual;
      }
      return value;
   };
   const minimumClipLength = () => minClipLength(0, 1 / (source?.streams.find((stream) => stream.type === "video")?.frameRate || 100));
   const splitTime = () => {
      if (!snapping || !clip) return clock.get();
      return keyframes
         .filter((point) => point >= clip.start && point <= clip.end)
         .reduce((best, point) => (Math.abs(point - clock.get()) < Math.abs(best - clock.get()) ? point : best), Infinity);
   };
   const available = () => !!source && !loading;
   const frameStep = 1 / (source?.streams.find((stream) => stream.type === "video")?.frameRate || 100);
   const stepFrame = (direction: number) => {
      videoRef.current?.pause();
      previewEnd.current = null;
      seeker.seek(clamp((Math.round(clock.get() / frameStep) + direction) * frameStep, 0, source!.duration), false);
   };
   const joinAtPlayhead = () =>
      mergePair(
         editor.document,
         clock.get(),
         frameStep,
         Math.max(
            frameStep,
            (((source!.duration * 100) / Math.max(1, zoom)) * 12) / Math.max(1, document.querySelector(".timeline-viewport")?.clientWidth ?? 1)
         )
      );
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
      snap: { enabled: () => available() && !readingKeys, run: () => setSnapping((value) => !value) },
      merge: {
         enabled: () => frozenAvailability("merge", () => available() && joinAtPlayhead() >= 0),
         run: () => commit(mergeClips(editor.document, joinAtPlayhead())),
      },
      toggleClip: {
         enabled: () => commands.delete.enabled() || commands.add.enabled(),
         run: () => (commands.delete.enabled() ? commands.delete.run() : commands.add.run()),
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
            previewEnd.current = clip.end;
            void videoRef.current.play().catch(() => setPreviewFailed(true));
         },
      },
      back: { enabled: available, run: () => seek(clock.get() - 1) },
      forward: { enabled: available, run: () => seek(clock.get() + 1) },
      backFast: { enabled: available, run: () => seek(clock.get() - 5) },
      forwardFast: { enabled: available, run: () => seek(clock.get() + 5) },
      previous: {
         enabled: () => frozenAvailability("previous", () => available() && adjacentBoundary(editor.document.clips, clock.get(), -1) !== null),
         run: () => selectAdjacent(-1),
      },
      next: {
         enabled: () => frozenAvailability("next", () => available() && adjacentBoundary(editor.document.clips, clock.get(), 1) !== null),
         run: () => selectAdjacent(1),
      },
      split: {
         enabled: () =>
            frozenAvailability(
               "split",
               () =>
                  available() &&
                  (!snapping || !readingKeys) &&
                  canSplit(editor.document, clock.get(), minimumClipLength()) &&
                  canSplit(editor.document, splitTime(), minimumClipLength())
            ),
         run: () => {
            const time = splitTime();
            const next = splitClip(editor.document, time, minimumClipLength());
            commit(next);
            seek(time);
         },
      },
      setStart: {
         enabled: () =>
            frozenAvailability(
               "setStart",
               () =>
                  available() &&
                  !!clipAt(editor.document, clock.get()) &&
                  clock.get() > clipAt(editor.document, clock.get())!.start &&
                  clock.get() < clipAt(editor.document, clock.get())!.end
            ),
         run: () => setBoundary("start", clock.get(), clipAt(editor.document, clock.get())),
      },
      setEnd: {
         enabled: () =>
            frozenAvailability(
               "setEnd",
               () =>
                  available() &&
                  !!clipAt(editor.document, clock.get()) &&
                  clock.get() > clipAt(editor.document, clock.get())!.start &&
                  clock.get() < clipAt(editor.document, clock.get())!.end
            ),
         run: () => setBoundary("end", clock.get(), clipAt(editor.document, clock.get())),
      },
      delete: {
         enabled: deleteReady,
         run: () => {
            const target = clipAt(editor.document, clock.get());
            if (target) commit(deleteClip({ ...editor.document, selectedId: target.id }));
         },
      },
      add: {
         enabled: () =>
            frozenAvailability("add", () => {
               if (!available()) return false;
               const gap = gapAt(editor.document, clock.get(), source!.duration);
               return !!gap && gap.end - gap.start >= minimumClipLength();
            }),
         run: () => {
            if (source) commit(addGap(editor.document, clock.get(), source.duration));
         },
      },
      undo: { enabled: () => available() && !!editor.past.length, run: () => dispatch({ type: "undo" }) },
      redo: { enabled: () => available() && !!editor.future.length, run: () => dispatch({ type: "redo" }) },
      fit: { enabled: available, run: () => setFitToken((value) => value + 1) },
      zoomIn: { enabled: available, run: () => setZoomRequest((value) => ({ id: value.id + 1, direction: 1 })) },
      zoomOut: { enabled: available, run: () => setZoomRequest((value) => ({ id: value.id + 1, direction: -1 })) },
      settings: { enabled: () => ready, run: () => setPanel("settings") },
      shortcuts: { enabled: () => ready, run: () => setPanel("shortcuts") },
   };
   useCommands(commands, preferences.shortcuts, mac, !!panel || !!menu);
   const prepare = async (track: number | null = audioIndex, transcode = false) => {
      if (!source) return;
      videoRef.current?.pause();
      setPreparing(true);
      setPreviewProgress(0);
      setPreviewFailed(true);
      setError(null);
      const id = source.id;
      try {
         const nextUrl = await window.desktop.preparePreview(id, track, transcode);
         if (sourceRef.current?.id === id) {
            setUrl(nextUrl);
            setPreviewFailed(false);
         }
      } catch (value) {
         if (sourceRef.current?.id === id) setError(errorText(value));
      } finally {
         if (sourceRef.current?.id === id) setPreparing(false);
      }
   };
   const menuItems: Record<string, CommandId[]> = {
      File: ["open", "frame", "export"],
      Edit: ["undo", "redo", "settings"],
      Clips: ["merge", "split", "setStart", "setEnd", "add", "delete", "preview"],
      View: ["zoomIn", "zoomOut", "fit", "settings"],
      Help: ["shortcuts"],
   };
   const errorPresence = useExitValue(error, 190);
   const jobPresence = useExitValue(job, 160);
   const video = source?.streams.find((stream) => stream.type === "video");
   const changeAudio = (index: number) => {
      setAudioIndex(index);
      if (source && videoRef.current && !selectNativeAudio(videoRef.current, source, index)) void prepare(index);
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
                     <div className="app-menu" key={name}>
                        <button
                           className={menu === name ? "active" : ""}
                           aria-haspopup="menu"
                           aria-expanded={menu === name}
                           onClick={() => setMenu(menu === name ? null : name)}
                        >
                           {name}
                        </button>
                        <NavDropdown
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
               <TopActions commands={commands} clock={clock} preferences={preferences} mac={mac} />
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
                        clock={clock}
                        clips={editor.document.clips}
                        keptOnly={preferences.keptOnly}
                        previewEnd={previewEnd}
                        volume={preferences.volume}
                        muted={muted}
                        audioIndex={audioIndex}
                        onPlaying={setPlaying}
                        onPreviewEnd={() => {
                           previewEnd.current = null;
                        }}
                        failed={previewFailed}
                        onFailure={() => {
                           setPreviewNeedsTranscode(true);
                           setPreviewFailed(true);
                        }}
                        onPrepare={() => {
                           void prepare(audioIndex, previewNeedsTranscode);
                        }}
                        preparing={preparing}
                        progress={previewProgress}
                        trimming={trimming}
                     />
                     <div className={`editor-dock${trimAnimating ? " trim-animating" : ""}`}>
                        <Timeline
                           key={source.id}
                           document={editor.document}
                           duration={source.duration}
                           frameStep={video?.frameRate ? 1 / video.frameRate : 0.01}
                           clock={clock}
                           fitToken={fitToken}
                           zoomRequest={zoomRequest}
                           onZoom={setZoom}
                           keyframes={keyframes}
                           snapping={snapping}
                           onSelect={(id) => dispatch({ type: "select", id })}
                           onCommit={commit}
                           onSeek={seek}
                           onTrimming={setTrimming}
                        />
                        <Transport
                           document={editor.document}
                           source={source}
                           clock={clock}
                           playing={playing}
                           commands={commands}
                           preferences={preferences}
                           mac={mac}
                           volume={preferences.volume}
                           muted={muted}
                           audioIndex={audioIndex}
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
               {loading && (
                  <div className="loading-overlay">
                     <span className="spinner" />
                     <strong>Opening video…</strong>
                     <span>Reading media information</span>
                  </div>
               )}
            </main>
            {jobPresence.mounted && jobPresence.value && (
               <JobProgress
                  job={jobPresence.value}
                  closing={jobPresence.closing}
                  onDismiss={() => setJob(null)}
                  onError={(value) => setError(value)}
                  onRetry={setJob}
               />
            )}
            {panel === "export" && source && (
               <ExportPanel
                  source={source}
                  clips={editor.document.clips}
                  preferences={preferences}
                  onPreferences={setPreferences}
                  onClose={() => setPanel(null)}
                  onStarted={setJob}
               />
            )}
            {panel === "frame" && source && (
               <FramePanel source={source} time={clock.get()} preferences={preferences} onPreferences={setPreferences} onClose={() => setPanel(null)} />
            )}
            {(panel === "settings" || panel === "shortcuts") && (
               <SettingsPanel
                  preferences={preferences}
                  onChange={setPreferences}
                  onClose={() => setPanel(null)}
                  mac={mac}
                  initialTab={panel === "shortcuts" ? "shortcuts" : "general"}
               />
            )}
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
