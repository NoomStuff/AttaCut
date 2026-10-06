import { useEffect, useReducer, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { MediaSource, ExportJob, SavedSession } from "../../../shared/types";
import { defaultPreferences } from "../../../shared/defaults";
import { encodeSession } from "../../../shared/session-codec";
import { isProjectPath, projectHasChanges, discardProjectChanges } from "../../../shared/project";
import { editorReducer, emptyEditor, newDocument } from "./model";
import { sessionFor } from "./session";
import { usePersistence } from "./persistence";
import { useDesktopLifecycle } from "../lib/desktopLifecycle";
import { errorText } from "../lib/errors";
import { usePlayback } from "../playback/usePlayback";
import { resolveAudioSelection } from "../playback/audioSelection";
import { nativeAudioCodecs } from "../playback/codecs";

export type EditorNotice = { text: string; tone: "error" | "warning" | "info" };

/** Owns the source, document, project, recovery and their desktop lifetime together. */
export function useEditorSession({
   setError,
   showError,
   onJob,
   onWorkspaceReset,
   onDocumentReset,
   onSourceOpened,
}: {
   setError: Dispatch<SetStateAction<EditorNotice | null>>;
   showError: (message: string | null) => void;
   onJob: (job: ExportJob) => void;
   onWorkspaceReset: () => void;
   onDocumentReset: () => void;
   onSourceOpened: () => void;
}) {
   const [source, setSource] = useState<MediaSource | null>(null);
   const [editor, dispatch] = useReducer(editorReducer, emptyEditor);
   const [preferences, setPreferences] = useState(defaultPreferences);
   const [ready, setReady] = useState(false);
   const [platform, setPlatform] = useState("win32");
   const [version, setVersion] = useState("");
   const [loading, setLoading] = useState(false);
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
   const player = usePlayback({ source, preferences, setPreferences, setError: showError });
   const { setPlaying, playback, setAudioIndices, videoRef, clock, seeker, scrubber, preparePreview } = player;
   const openSequence = useRef(0);
   const replacingSourceId = useRef<string | null>(null);
   const sourceRef = useRef(source);
   sourceRef.current = source;
   const documentRef = useRef(editor.document);
   documentRef.current = editor.document;
   // Saved eagerly here, and again on every change by the effect in usePersistence: this
   // call flushes the outgoing source's session before another one loads, so restoring
   // always sees the latest edit.
   const saveCurrent = async () => {
      const snapshot = sessionFor(source, editor, null, projectRef.current);
      if (snapshot) await window.desktop.saveSession(encodeSession(snapshot));
   };
   const saveProjectSnapshot = async (saveAs = false): Promise<boolean> => {
      const snapshot = sessionFor(source, editor, null, project);
      if (!snapshot || savingRef.current) return false;
      savingRef.current = true;
      setSavingProject(true);
      try {
         const saved = await window.desktop.saveProject(encodeSession(snapshot), saveAs);
         if (!saved) return false;
         if (sourceRef.current?.id === source?.id) {
            await window.desktop.saveSession(encodeSession(saved));
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
         const decision = await window.desktop.confirmProject(encodeSession(snapshot));
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
      onWorkspaceReset();
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
         onDocumentReset();
         clock.set(0);
         setPlaying(false);
         const sourceAudio = media.streams.filter((stream) => stream.type === "audio");
         const selectedAudio = resolveAudioSelection(sourceAudio, playbackAudio);
         const firstAudio = sourceAudio.find((stream) => selectedAudio.includes(stream.index));
         // Chromium may silently omit an unsupported audio track while playing video.
         const needsAudioPreview = selectedAudio.length > 1 || (!!firstAudio && !nativeAudioCodecs.has(firstAudio.codec));
         setAudioIndices(selectedAudio);
         // Such recordings get their waveform from the prepared preview (compact and
         // indexed) rather than a slow walk over the huge source; the preparation holds
         // the waveform until it lands.
         if (needsAudioPreview) void preparePreview(media, selectedAudio);
         dispatch({
            type: "load",
            document: validSaved ? { clips: validSaved.clips, selectedId: validSaved.selectedId } : newDocument(media.duration),
            past: validSaved ? validSaved.past : [],
            future: validSaved ? validSaved.future : [],
         });
         onSourceOpened();
         setRestore(null);
      } catch (value) {
         if (sequence === openSequence.current) {
            const message = errorText(value);
            const name = path.replaceAll("\\", "/").split("/").at(-1);
            // Expected, recoverable open failures explain themselves with the file's name
            // instead of echoing stat, errno, or ffprobe strings.
            if (/no such file or directory/i.test(message)) {
               setError({ text: `"${name}" was moved or changed and can't be found.`, tone: "warning" });
            } else if (/still image/i.test(message)) {
               setError({ text: `"${name}" is a still image. AttaCut trims videos, so still images can't be opened.`, tone: "warning" });
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
      onWorkspaceReset();
      setError(null);
      const snapshot = sessionFor(source, editor, restore, projectRef.current);
      setRestore(keepRecovery && preferences.resume && snapshot ? discardProjectChanges(snapshot) : null);
      setProject(undefined);
      void window.desktop.closeSource().catch((value) => showError(errorText(value)));
      setLoading(false);
      videoRef.current?.pause();
      scrubber.stop();
      scrubber.reset();
      setSource(null);
      sourceRef.current = null;
      onDocumentReset();
      clock.set(0);
      setPlaying(false);
      dispatch({ type: "load", document: { clips: [], selectedId: null } });
      void window.desktop.setWindowTitle("AttaCut").catch(() => {});
   };
   // The reset IPC runs before any teardown: if it failed midway, the workspace must not
   // already be cleared, or the start screen would claim a reset that never happened.
   const factoryReset = async () => {
      try {
         await window.desktop.factoryReset();
      } catch (value) {
         showError(errorText(value));
         return;
      }
      closeProject(false);
      setPreferences(defaultPreferences);
   };
   useDesktopLifecycle({
      onBootstrap: async (data, signal) => {
         setPreferences(data.preferences);
         setPlatform(data.platform);
         setVersion(data.version);
         setRestore(data.preferences.resume ? data.session : null);
         setReady(true);
         if (data.initialFile) await openPath(data.initialFile, undefined, data.preferences.playbackAudio, false);
         else if (data.preferences.resume && data.session) await openPath(data.session.path, data.session, data.preferences.playbackAudio, false);
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
         onJob(updated);
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
   const beforeSourceReplace = async () => {
      if (!source) return;
      replacingSourceId.current = source.id;
      playback.suspend();
      scrubber.stop();
      await Promise.all([window.desktop.cancelPreview(), window.desktop.cancelScrub()]);
      const video = videoRef.current;
      video?.pause();
      video?.removeAttribute("src");
      video?.load();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
   };
   const sourceReplaceStartFailed = () => {
      replacingSourceId.current = null;
      if (source) playback.source(source);
   };
   return {
      source,
      sourceRef,
      editor,
      documentRef,
      dispatch,
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
      savingProject,
      player,
      openPath,
      choose,
      saveProject,
      confirmProject,
      closeProject,
      factoryReset,
      beforeSourceReplace,
      sourceReplaceStartFailed,
   };
}
export type EditorSession = ReturnType<typeof useEditorSession>;
