import { useEditorCommands } from "./editor/useEditorCommands";
import type { EditorPanel } from "./editor/useEditorCommands";
import { useEditorInteraction } from "./editor/useEditorInteraction";
import { useEditorSession } from "./editor/useEditorSession";
import { NavDropdown } from "./components/NavDropdown";
import { useAppearance } from "./lib/appearance";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ExportJob, AvailableUpdate } from "../../shared/types";
import { CommandContext, useCommands } from "./editor/commands";
import type { CommandId } from "./editor/commands";
import { createDraftStore } from "./editor/draftStore";
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
import { useWaveform } from "./lib/waveform";
import { useTemporarySnapping } from "./lib/temporarySnapping";
import { errorText } from "./lib/errors";
import { useExitValue, usePressFeedback } from "./lib/motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faScissors,
   faFolderOpen,
   faMinus,
   faSquare,
   faXmark,
   faCircleExclamation,
   faCircleInfo,
   faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

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

export default function App() {
   // The architecture test counts root commits. Clear each mark to bound the buffer.
   useEffect(() => {
      performance.mark("attacut:editor-commit");
      performance.clearMarks("attacut:editor-commit");
   });
   usePressFeedback();
   const [exportDraft, setExportDraft] = useState<ExportDraft | null>(null);
   const [panel, setPanel] = useState<EditorPanel>(null);
   const [helpTab, setHelpTab] = useState<HelpTab>("intro");
   const [exportHelp, setExportHelp] = useState(false);
   const [menu, setMenu] = useState<string | null>(null);
   const [confirmReset, setConfirmReset] = useState(false);
   const [error, setError] = useState<{ text: string; tone: "error" | "warning" | "info" } | null>(null);
   /** Errors interrupt work and deserve the red banner; warnings only explain a recoverable state. */
   const showError = useCallback((message: string | null) => setError(message === null ? null : { text: message, tone: "error" }), []);
   const [update, setUpdate] = useState<AvailableUpdate | null>(null);
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
   // Pans (preview) or zooms and pans (focus) the timeline onto a clip range.
   const [viewRequest, setViewRequest] = useState({ id: 0, start: 0, end: 0, zoom: false });
   // The player overlays the window while the window itself takes over the screen, so the
   // custom controls stay and window management, multi-monitor layouts, and background
   // presentation behave identically in and out.
   const [fullscreen, setFullscreen] = useState(false);
   const [dragStore] = useState(createDraftStore);
   const session = useEditorSession({
      setError,
      showError,
      onJob: receiveJob,
      onWorkspaceReset: () => {
         setMenu(null);
         setPanel(null);
         setExportHelp(false);
         setFullscreen(false);
         dragStore.set(null);
      },
      onDocumentReset: () => remember(undefined),
      onSourceOpened: () => {
         setFitToken((value) => value + 1);
         setZoomRequest((value) => ({ id: value.id + 1, direction: 0 }));
      },
   });
   const {
      source,
      editor,
      preferences,
      setPreferences,
      ready,
      platform,
      version,
      restore,
      project,
      projectDirty,
      projectName,
      loading,
      openPath,
      choose,
      factoryReset,
      beforeSourceReplace,
      sourceReplaceStartFailed,
   } = session;
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
      videoRef,
      clock,
      seeker,
      scrubber,
      preparePreview,
      changeAudio,
   } = session.player;
   // The startup check stays quiet, runs once, and only an explicit check reports when
   // nothing was found.
   const startupUpdateCheck = useRef(false);
   useEffect(() => {
      if (!ready || startupUpdateCheck.current) return;
      startupUpdateCheck.current = true;
      if (!preferences.updateCheck) return;
      let active = true;
      void window.desktop
         .checkForUpdate()
         .then((value) => {
            if (active) setUpdate(value);
         })
         .catch(() => {});
      return () => {
         active = false;
      };
   }, [ready, preferences.updateCheck]);
   const checkForUpdates = useCallback(() => {
      void window.desktop
         .checkForUpdate()
         .then((value) => {
            setUpdate(value);
            if (!value) setError({ text: "You're on the latest version of AttaCut.", tone: "info" });
         })
         .catch((value: unknown) => showError(errorText(value)));
   }, [showError]);
   const temporarySnapping = useTemporarySnapping(!!panel || loading || !source, preferences.holdToSnap);
   const snapping = preferences.snapping || temporarySnapping;
   const [draggingFile, setDraggingFile] = useState(false);
   const mac = platform === "darwin";
   // The volume gesture carries the pre-mute level so unmuting restores it.
   const updateVolume = useCallback(
      (volume: number, restore: number) => {
         setMuted(volume === 0);
         setPreferences((current) => ({ ...current, volume: volume === 0 ? restore : volume }));
      },
      [setMuted, setPreferences]
   );
   // Drive the OS window state from the renderer's fullscreen flag, and follow native exits
   // (macOS Escape, system gestures) back into that flag.
   useEffect(() => window.desktop.onWindowFullscreen(setFullscreen), []);
   useEffect(() => {
      window.desktop.windowAction(fullscreen ? "enterFullscreen" : "exitFullscreen");
   }, [fullscreen]);
   // The export panel must never show its loader behind a click, and the idle prefetch
   // below waits out preview preparation first. Import it eagerly once a source exists.
   useEffect(() => {
      if (source) void loadExportPanel();
   }, [source]);
   useEffect(() => {
      if (!ready || loading || preparing) return;
      return prefetchModules([loadSettingsPanel, loadFramePanel, loadHelpPanel, loadAboutPanel]);
   }, [ready, loading, preparing]);
   const { keyframes, reading: readingKeys } = useKeyframes({ source, snapping, loading, preparing, videoRef, onError: showError });
   const editing = useEditorInteraction({ session, snapping, keyframes, onError: showError });
   const { timelineDocument, trimming, trimAnimating, setTrimming, remember, commit, seek, frameStep, setBoundary } = editing;
   // The player's media id: the source itself, or the prepared preview once a recording
   // that needs a transcode swapped to it.
   const waveformMediaId = url.startsWith("media://source/") ? decodeURIComponent(new URL(url).pathname.slice(1)) : null;
   // A preview preparation outranks the waveform: while one runs for this source, hold the
   // decode instead of fighting the transcode for disk and CPU, then decode from the
   // compact preview. If the preparation fails or never happens, the source itself is
   // decoded in the background.
   const waveformDecodeId = source && (preparing ? null : waveformMediaId && waveformMediaId !== source.id ? waveformMediaId : source.id);
   const waveform = useWaveform({ source, enabled: preferences.waveform, audioIndices, decodeMediaId: waveformDecodeId });
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
   // Panels open above the workspace; fullscreen video yields to all of them.
   const openPanel = (next: EditorPanel) => {
      setFullscreen(false);
      setPanel(next);
   };
   const [settingsTab, setSettingsTab] = useState<"general" | "editing" | "shortcuts">("general");
   const openSettings = (tab: "general" | "editing") => {
      setSettingsTab(tab);
      openPanel("settings");
   };
   const onZoomReport = useCallback((percent: number) => setZoom(percent), []);
   const { commands, togglePlay } = useEditorCommands({
      session,
      editing,
      keyframes,
      readingKeys,
      snapping,
      zoom,
      job,
      onError: showError,
      onWarning: (text) => setError({ text, tone: "warning" }),
      view: {
         openPanel,
         openSettings,
         toggleFullscreen: () => setFullscreen((value) => !value),
         showClip: (clip, zoom) => setViewRequest((current) => ({ id: current.id + 1, start: clip.start, end: clip.end, zoom })),
         fit: () => setFitToken((value) => value + 1),
         zoom: (direction) => setZoomRequest((value) => ({ id: value.id + 1, direction })),
         confirmReset: () => setConfirmReset(true),
         openHelp: () => {
            setHelpTab("intro");
            openPanel("help");
         },
         checkForUpdates,
      },
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
      View: [["zoomIn", "zoomOut", "fit", "focusClip"], ["preview"], ["fullscreen"], ["options"]],
      Help: [["help", "shortcuts", "about"], ["updates", "releases"], ["reset"]],
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
               <AppUpdate update={update} onError={showError} />
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
                     className={`error-banner${errorPresence.value.tone === "warning" ? " warning" : errorPresence.value.tone === "info" ? " info" : ""}`}
                     role={errorPresence.value.tone === "error" ? "alert" : "status"}
                  >
                     <FontAwesomeIcon
                        icon={
                           errorPresence.value.tone === "warning"
                              ? faTriangleExclamation
                              : errorPresence.value.tone === "info"
                                ? faCircleInfo
                                : faCircleExclamation
                        }
                     />
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
                        url={url}
                        videoRef={videoRef}
                        playback={playback}
                        clock={clock}
                        clips={editor.document.clips}
                        keptOnly={preferences.keptOnly}
                        volume={preferences.volume}
                        muted={muted}
                        audioIndices={audioIndices}
                        onAudio={changeAudio}
                        onVolume={updateVolume}
                        onSeek={seek}
                        playing={playing}
                        fullscreen={fullscreen}
                        onSetFullscreen={setFullscreen}
                        onTogglePlay={togglePlay}
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
                        document={timelineDocument}
                        duration={source.duration}
                        frameStep={frameStep}
                        clock={clock}
                        fitToken={fitToken}
                        zoomRequest={zoomRequest}
                        viewRequest={viewRequest}
                        onZoom={onZoomReport}
                        keyframes={keyframes}
                        snapping={snapping}
                        playing={playing || playWhenReady}
                        waveform={preferences.waveform ? waveform : null}
                        onSelect={(id) => remember(editor.document.clips.find((item) => item.id === id))}
                        onCommit={commit}
                        onSeek={seek}
                        onDraft={dragStore.set}
                        onTrimming={setTrimming}
                     />
                     <Transport
                        document={timelineDocument}
                        draftStore={dragStore}
                        source={source}
                        playing={playing}
                        volume={preferences.volume}
                        muted={muted}
                        audioIndices={audioIndices}
                        onAudio={changeAudio}
                        onVolume={updateVolume}
                        onBoundary={setBoundary}
                        onFullscreen={() => setFullscreen(true)}
                        onSettings={() => openPanel("settings")}
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
            <Suspense key={panel} fallback={null}>
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
                     onBeforeSourceReplace={beforeSourceReplace}
                     onSourceReplaceStartFailed={sourceReplaceStartFailed}
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
                     initialTab={panel === "shortcuts" ? "shortcuts" : settingsTab}
                     onTabChange={setSettingsTab}
                     source={source}
                     clips={editor.document.clips}
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
                           setConfirmReset(false);
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
