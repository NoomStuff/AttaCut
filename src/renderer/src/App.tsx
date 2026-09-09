import { useEffect, useReducer, useRef, useState } from "react";
import type { MediaSource, Preferences, ExportJob, SavedSession } from "../../shared/types";
import { defaultPreferences } from "../../shared/types";
import { clamp } from "../../shared/time";
import { adjacentBoundary, snapBoundary } from "./editor/navigation";
import { selectNativeAudio } from "./playback/audio";
import { PlaybackSeeker } from "./playback/seeker";
import { nextKeptTime } from "./playback/ranges";
import { FramePanel } from "./components/FramePanel";
import { addGap, canSplit, deleteClip, editorReducer, emptyEditor, gapAt, newDocument, selectedClip, splitClip, trimClip } from "./editor/model";
import type { EditDocument } from "./editor/model";
import { bindingFor, commandDefinitions, displayBinding, useCommands } from "./editor/commands";
import type { CommandId, Commands } from "./editor/commands";
import { PlaybackClock, useClock } from "./playback/clock";
import { Button, IconButton, Modal } from "./components/Controls";
import { Player } from "./components/Player";
import { Timeline } from "./components/Timeline";
import { Transport } from "./components/Transport";
import { ExportPanel, errorText } from "./components/ExportPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faScissors,
   faRotateLeft,
   faRotateRight,
   faArrowUpFromBracket,
   faFolderOpen,
   faMinus,
   faSquare,
   faXmark,
   faArrowRight,
   faCheck,
   faCircleExclamation,
   faPlus,
   faTrash,
   faCamera,
} from "@fortawesome/free-solid-svg-icons";

type Panel = "export" | "frame" | "settings" | "shortcuts" | "about" | null;
const HERO_HOLES = [15, 27, 39, 51, 63, 75, 87];
const HERO_HOLES_RIGHT = [104, 116, 128];
export default function App() {
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
   const [version, setVersion] = useState("");
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
   const [trimming, setTrimmingState] = useState(false);
   const videoRef = useRef<HTMLVideoElement>(null);
   const previewEnd = useRef<number | null>(null);
   const trimmingRef = useRef(false);
   const setTrimming = (active: boolean) => {
      trimmingRef.current = active;
      setTrimmingState(active);
   };
   // Dragging a handle pins the playhead onto the edited boundary, which would flip Split/Add
   // availability on sub-step rounding while the draft is not yet committed. Hold the pre-drag
   // availability until the drag settles.
   const idleAvailability = useRef({ split: true, add: true });
   const frozenAvailability = (key: "split" | "add", evaluate: () => boolean): boolean => {
      const value = evaluate();
      if (!trimmingRef.current) idleAvailability.current[key] = value;
      return trimmingRef.current ? idleAvailability.current[key] : value;
   };
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
      previewEnd.current = null;
      seeker.seek(target, preferences.keepPlaying);
   };
   const fullscreen = () => {
      const action = document.fullscreenElement ? document.exitFullscreen() : videoRef.current?.requestFullscreen();
      void action?.catch((value) => setError(errorText(value)));
   };
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
            setVersion(data.version);
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
   const setBoundary = (side: "start" | "end", value: number) => {
      if (source && clip) {
         const next = trimClip(
            editor.document,
            clip.id,
            side,
            snapping ? snapBoundary(editor.document, clip.id, side, value, keyframes, source.duration) : value,
            source.duration
         );
         const actual = next.clips.find((item) => item.id === clip.id)![side];
         if (actual === clip[side]) return actual;
         commit(next);
         seek(actual);
         return actual;
      }
      return value;
   };
   const splitTime = () => {
      if (!snapping || !clip) return clock.get();
      return keyframes
         .filter((point) => point >= clip.start && point <= clip.end)
         .reduce((best, point) => (Math.abs(point - clock.get()) < Math.abs(best - clock.get()) ? point : best), Infinity);
   };
   const available = () => !!source && !loading;
   const commands: Commands = {
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
         enabled: () => available() && adjacentBoundary(editor.document.clips, clock.get(), -1) !== null,
         run: () => selectAdjacent(-1),
      },
      next: { enabled: () => available() && adjacentBoundary(editor.document.clips, clock.get(), 1) !== null, run: () => selectAdjacent(1) },
      split: {
         enabled: () =>
            frozenAvailability(
               "split",
               () => available() && (!snapping || !readingKeys) && canSplit(editor.document, clock.get()) && canSplit(editor.document, splitTime())
            ),
         run: () => {
            const time = splitTime();
            commit(splitClip(editor.document, time));
            seek(time);
         },
      },
      setStart: { enabled: () => available() && !!clip && clock.get() < clip.end, run: () => setBoundary("start", clock.get()) },
      setEnd: { enabled: () => available() && !!clip && clock.get() > clip.start, run: () => setBoundary("end", clock.get()) },
      delete: { enabled: () => available() && !!clip, run: () => commit(deleteClip(editor.document)) },
      add: {
         enabled: () => frozenAvailability("add", () => available() && !!gapAt(editor.document, clock.get(), source!.duration)),
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
      about: { enabled: () => true, run: () => setPanel("about") },
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
      Clips: ["split", "setStart", "setEnd", "add", "delete", "preview"],
      View: ["zoomIn", "zoomOut", "fit", "settings"],
      Help: ["shortcuts", "about"],
   };
   const video = source?.streams.find((stream) => stream.type === "video");
   const changeAudio = (index: number) => {
      setAudioIndex(index);
      if (source && videoRef.current && !selectNativeAudio(videoRef.current, source, index)) void prepare(index);
   };
   return (
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
                     {menu === name && (
                        <div className="dropdown" role="menu">
                           {ids.map((id) => (
                              <button
                                 role="menuitem"
                                 key={id}
                                 disabled={!commands[id].enabled()}
                                 onClick={() => {
                                    setMenu(null);
                                    commands[id].run();
                                 }}
                              >
                                 <span>{commandDefinitions[id].label}</span>
                                 <kbd>{displayBinding(bindingFor(id, preferences.shortcuts), mac)}</kbd>
                              </button>
                           ))}
                        </div>
                     )}
                  </div>
               ))}
            </nav>
            <TopActions commands={commands} clock={clock} preferences={preferences} mac={mac} />
         </header>
         {error && (
            <div className="error-banner" role="alert">
               <FontAwesomeIcon icon={faCircleExclamation} />
               <span>{error}</span>
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
                  <div className="editor-dock">
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
                        onMute={() => setMuted(!muted)}
                        onVolume={(volume) => {
                           setMuted(false);
                           setPreferences({ ...preferences, volume });
                        }}
                        onSettings={() => setPanel("settings")}
                        onBoundary={setBoundary}
                        onFullscreen={fullscreen}
                        zoom={zoom}
                        snapping={snapping}
                        readingKeys={readingKeys}
                        onSnap={() => setSnapping((value) => !value)}
                     />
                  </div>
               </>
            ) : (
               <div className="empty-state">
                  <div className="empty-hero" aria-hidden="true">
                     <svg viewBox="0 0 148 76" width="148" height="76">
                        <g>
                           <rect className="hero-body" x="8" y="22" width="90" height="36" rx="7" />
                           {HERO_HOLES.map((x) => (
                              <rect key={`lt${x}`} className="hero-hole" x={x} y="26.5" width="5" height="4.5" rx="1.5" />
                           ))}
                           {HERO_HOLES.map((x) => (
                              <rect key={`lb${x}`} className="hero-hole" x={x} y="49" width="5" height="4.5" rx="1.5" />
                           ))}
                        </g>
                        <g className="hero-piece">
                           <g className="hero-piece-inner">
                              <rect className="hero-body kept" x="98" y="22" width="42" height="36" rx="7" />
                              {HERO_HOLES_RIGHT.map((x) => (
                                 <rect key={`rt${x}`} className="hero-hole" x={x} y="26.5" width="5" height="4.5" rx="1.5" />
                              ))}
                              {HERO_HOLES_RIGHT.map((x) => (
                                 <rect key={`rb${x}`} className="hero-hole" x={x} y="49" width="5" height="4.5" rx="1.5" />
                              ))}
                           </g>
                        </g>
                        <line className="hero-cut" x1="98" y1="5" x2="98" y2="71" />
                     </svg>
                     <span className="hero-scissors">
                        <FontAwesomeIcon icon={faScissors} />
                     </span>
                  </div>
                  <h1>Cut your clips, move on.</h1>
                  <p>Drag & drop or import a video file.</p>
                  <Button
                     icon={faFolderOpen}
                     variant="primary"
                     onClick={() => {
                        void choose();
                     }}
                     disabled={loading}
                  >
                     Import video <FontAwesomeIcon icon={faArrowRight} />
                  </Button>
                  <span className="empty-shortcut">
                     or use <kbd>{mac ? "⌘" : "Ctrl"}</kbd> <kbd>O</kbd>
                  </span>
                  <div className="empty-timeline" aria-hidden="true">
                     <i className="empty-track" />
                     <span className="empty-clip c0" />
                     <span className="empty-clip c1" />
                     <span className="empty-clip c2" />
                     <span className="empty-playhead" />
                  </div>
               </div>
            )}
            {loading && (
               <div className="loading-overlay">
                  <span className="spinner" />
                  <strong>Opening video…</strong>
                  <span>Reading media information</span>
               </div>
            )}
         </main>
         {job && <JobProgress job={job} onDismiss={() => setJob(null)} onError={(value) => setError(value)} onRetry={setJob} />}
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
         {panel === "about" && (
            <Modal title="AttaCut" description="A little less video. A lot less fuss." onClose={() => setPanel(null)}>
               <div className="modal-body">
                  <p>Version {version}</p>
               </div>
            </Modal>
         )}
         {draggingFile && (
            <div className="drop-overlay">
               <FontAwesomeIcon icon={faFolderOpen} />
               <span>Drop to Import video</span>
            </div>
         )}
      </div>
   );
}
function TopActions({ commands, clock, preferences, mac }: { commands: Commands; clock: PlaybackClock; preferences: Preferences; mac: boolean }) {
   useClock(clock);
   return (
      <div className="top-actions">
         <IconButton icon={faPlus} label="Add clip in gap" disabled={!commands.add.enabled()} onClick={commands.add.run} />
         <IconButton
            icon={faTrash}
            label="Delete selected clip"
            disabled={!commands.delete.enabled()}
            onClick={commands.delete.run}
            shortcut={displayBinding(bindingFor("delete", preferences.shortcuts), mac)}
         />
         <Button
            icon={faScissors}
            data-command="split"
            disabled={!commands.split.enabled()}
            onClick={commands.split.run}
            shortcut={displayBinding(bindingFor("split", preferences.shortcuts), mac)}
         >
            Split
         </Button>
         <span className="control-divider" />
         <IconButton
            icon={faRotateLeft}
            label="Undo"
            data-command="undo"
            disabled={!commands.undo.enabled()}
            onClick={commands.undo.run}
            shortcut={displayBinding(bindingFor("undo", preferences.shortcuts), mac)}
         />
         <IconButton
            icon={faRotateRight}
            label="Redo"
            data-command="redo"
            disabled={!commands.redo.enabled()}
            onClick={commands.redo.run}
            shortcut={displayBinding(bindingFor("redo", preferences.shortcuts), mac)}
         />
         <span className="control-divider" />
         <IconButton icon={faCamera} label="Export current frame" disabled={!commands.frame.enabled()} onClick={commands.frame.run} />
         <Button variant="primary" icon={faArrowUpFromBracket} data-command="export" disabled={!commands.export.enabled()} onClick={commands.export.run}>
            Export
         </Button>
      </div>
   );
}
function JobProgress({
   job,
   onDismiss,
   onError,
   onRetry,
}: {
   job: ExportJob;
   onDismiss: () => void;
   onError: (value: string) => void;
   onRetry: (value: ExportJob) => void;
}) {
   const complete = job.items.filter((item) => item.status === "completed").length;
   const failures = job.items.filter((item) => item.status === "failed" || item.status === "cancelled");
   const progress = job.items.reduce((sum, item) => sum + item.progress, 0) / job.items.length;
   return (
      <aside className="job-progress" aria-live="polite">
         <div className="job-summary">
            <FontAwesomeIcon icon={job.running ? faArrowUpFromBracket : failures.length ? faCircleExclamation : faCheck} />
            <div>
               <strong>{job.running ? `Exporting ${complete + 1} of ${job.items.length}` : `${complete} ${complete === 1 ? "clip" : "clips"} exported`}</strong>
               <small>
                  {job.running
                     ? job.items.find((item) => item.status === "running")?.name
                     : failures.length
                       ? `${failures.length} unfinished`
                       : "Saved and ready to use"}
               </small>
            </div>
            {!job.running && <IconButton icon={faXmark} label="Dismiss export status" onClick={onDismiss} />}
         </div>
         {job.running && <progress max={1} value={progress} />}
         {failures.length > 0 && (
            <details>
               <summary>Export details</summary>
               {failures.map((item) => (
                  <p key={item.id}>
                     {item.name}: {item.error ?? item.status}
                  </p>
               ))}
            </details>
         )}
         <div className="job-actions">
            {job.running ? (
               <Button
                  onClick={() => {
                     void window.desktop.cancelExport();
                  }}
               >
                  Cancel
               </Button>
            ) : (
               <>
                  {failures.length > 0 && (
                     <Button
                        onClick={() => {
                           void window.desktop
                              .retryExport(job.id)
                              .then(onRetry)
                              .catch((value: unknown) => onError(errorText(value)));
                        }}
                     >
                        Retry unfinished
                     </Button>
                  )}
                  <Button
                     icon={faFolderOpen}
                     onClick={() => {
                        void window.desktop.revealOutput(job.directory).catch((value: unknown) => onError(errorText(value)));
                     }}
                  >
                     Open folder
                  </Button>
               </>
            )}
         </div>
      </aside>
   );
}
