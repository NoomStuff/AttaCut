import { useEffect, useState } from "react";
import type { Clip, ExportJob, ExportPlan, CutReport, MediaSource, Preferences } from "../../../shared/types";
import { exportExtensionFor } from "../../../shared/types";
import { formatTime } from "../../../shared/time";
import { faArrowUpFromBracket, faCircleExclamation, faCircleInfo, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, Modal, Toggle } from "./Controls";
import { DropdownSelect } from "./DropdownSelect";
import { errorText } from "../lib/errors";
import { clipColor } from "../editor/colors";
import type { HelpTab } from "./HelpPanel";
import { audioTrackLabel, rememberAudioSelection, resolveAudioSelection } from "../playback/audioSelection";

export interface ExportDraft {
   sourceId: string;
   directory: string;
   mode: Preferences["exportMode"];
   audioTracks: number[];
   name: string;
   rows: { clip: Clip; included: boolean; name: string }[];
}

export function ExportPanel({
   source,
   draft,
   onDraft,
   clips,
   preferences,
   onPreferences,
   onClose,
   onStarted,
   onHelp,
}: {
   source: MediaSource;
   draft: ExportDraft | null;
   onDraft: (draft: ExportDraft) => void;
   clips: Clip[];
   preferences: Preferences;
   onPreferences: (value: Preferences) => void;
   onClose: () => void;
   onStarted: (job: ExportJob) => void;
   onHelp?: (topic: HelpTab) => void;
}) {
   const saved = draft?.sourceId === source.id ? draft : null;
   const sourceAudio = source.streams.filter((stream) => stream.type === "audio");
   const [directory, setDirectory] = useState(saved?.directory ?? (preferences.outputDirectory || source.directory));
   const [mode, setMode] = useState<Preferences["exportMode"]>(saved?.mode ?? (clips.length === 1 ? "combined" : preferences.exportMode));
   const [audioTracks, setAudioTracks] = useState(saved?.audioTracks ?? resolveAudioSelection(sourceAudio, preferences.exportAudio, true));
   const [name, setName] = useState(saved?.name ?? `${source.name.slice(0, -source.extension.length)} (Trim)`);
   const [rows, setRows] = useState(() =>
      clips.map((clip, index) => ({
         clip,
         included: saved?.rows.find((row) => row.clip.id === clip.id)?.included ?? true,
         name: saved?.rows.find((row) => row.clip.id === clip.id)?.name ?? `${source.name.slice(0, -source.extension.length)} (${index + 1})`,
      }))
   );
   useEffect(() => {
      onDraft({ sourceId: source.id, directory, mode, audioTracks, name, rows });
   }, [source.id, directory, mode, audioTracks, name, rows, onDraft]);
   useEffect(() => {
      const exportAudio = rememberAudioSelection(sourceAudio, audioTracks);
      if (
         preferences.outputDirectory !== directory ||
         preferences.exportMode !== mode ||
         JSON.stringify(preferences.exportAudio) !== JSON.stringify(exportAudio)
      )
         onPreferences({ ...preferences, outputDirectory: directory, exportMode: mode, exportAudio });
   }, [directory, mode, audioTracks, preferences, onPreferences]);
   const [confirmation, setConfirmation] = useState<ExportPlan | null>(null);
   const request = {
      sourceId: source.id,
      directory,
      mode: mode,
      audioTracks,
      name,
      items: rows.filter((row) => row.included).map((row, index) => ({ clip: row.clip, name: mode === "combined" ? `Clip ${index + 1}` : row.name })),
   };
   const [error, setError] = useState<string | null>(null);
   const [starting, setStarting] = useState(false);
   const [analysis, setAnalysis] = useState<CutReport[] | null>(null);
   const selectedCount = request.items.length;
   // Media analysis is independent of filenames and destination checks, and reused at export.
   useEffect(() => {
      let cancelled = false;
      setAnalysis(null);
      window.desktop
         .analyzeExport({ sourceId: source.id, directory, mode, audioTracks, items: clips.map((clip) => ({ clip, name: "clip" })) })
         .then((items) => {
            if (!cancelled) setAnalysis(items);
         })
         .catch(() => {
            // The note is informational; click-time planning still reports real problems.
         });
      return () => {
         cancelled = true;
         void window.desktop.cancelExportPlanning();
      };
   }, [source.id, mode, audioTracks]);
   const valid = request.items.length > 0 && !!directory.trim() && (mode === "combined" ? !!name.trim() : request.items.every((item) => !!item.name.trim()));
   const start = async (approved?: ExportPlan) => {
      if (!valid || starting) return;
      setStarting(true);
      setError(null);
      try {
         const plan = approved ?? (await window.desktop.planExport(request));
         const unsupported = plan.items.find((item) => item.method === "unsupported");
         if (unsupported) throw new Error(unsupported.message);
         if (!approved && (plan.directoryMissing || plan.existingPaths.length)) {
            setConfirmation(plan);
            setStarting(false);
            return;
         }
         const job = await window.desktop.startExport(
            plan.id,
            approved ? { createDirectory: plan.directoryMissing, overwrite: plan.existingPaths.length > 0 } : undefined
         );
         setConfirmation(null);
         onPreferences({ ...preferences, outputDirectory: directory, exportMode: mode, exportAudio: rememberAudioSelection(sourceAudio, audioTracks) });
         onStarted(job);
         onClose();
      } catch (value) {
         setConfirmation(null);
         setError(errorText(value));
         setStarting(false);
      }
   };
   const confirmationModal = confirmation ? (
      <Modal
         key="confirmation"
         closeDisabled={starting}
         title={
            confirmation.directoryMissing
               ? "Create output folder?"
               : confirmation.existingPaths.length === 1
                 ? "Replace existing file?"
                 : "Replace existing files?"
         }
         onClose={() => setConfirmation(null)}
         className="export-confirmation"
      >
         <div className="modal-body">
            <p>
               {confirmation.directoryMissing
                  ? `This folder does not exist. Create it and export ${mode === "combined" ? "the video" : selectedCount === 1 ? "the clip" : "the clips"}?`
                  : confirmation.existingPaths.length === 1
                    ? "This file already exists. Exporting will replace it. This cannot be undone."
                    : "These files already exist. Exporting will replace them. This cannot be undone."}
            </p>
            <div className="export-conflicts">
               {confirmation.directoryMissing ? confirmation.directory : confirmation.existingPaths.map((path) => <div key={path}>{path}</div>)}
            </div>
         </div>
         <div className="modal-footer">
            <Button disabled={starting} onClick={() => setConfirmation(null)}>
               Cancel
            </Button>
            <Button
               variant="danger"
               disabled={starting}
               onClick={() => {
                  void start(confirmation);
               }}
            >
               {starting ? "Exporting…" : confirmation.directoryMissing ? "Create folder and export" : "Replace and export"}
            </Button>
         </div>
      </Modal>
   ) : null;
   const includedIds = new Set(rows.filter((row) => row.included).map((row) => row.clip.id));
   const checked = analysis?.filter((item) => includedIds.has(item.clip.id)) ?? [];
   const problem = checked.find((item) => item.method === "unsupported");
   const encoded = checked.reduce((sum, item) => sum + item.encodedSeconds, 0);
   const encodedLabel = (seconds: number) => (seconds < 0.1 ? "~0.1 seconds" : `~${seconds.toFixed(1)} seconds`);
   const note = problem ? problem.message : encoded > 0 ? `${encodedLabel(encoded)} may be re-encoded.` : "Exporting losslessly.";
   return (
      <>
         <Modal
            key="options"
            closeDisabled={starting}
            title={mode === "combined" ? "Export video" : selectedCount === 1 ? "Export clip" : "Export clips"}
            onClose={() => {
               if (!starting) onClose();
            }}
            className="export-modal"
         >
            <div className="modal-body">
               {clips.length > 1 && (
                  <div className="export-mode" data-mode={mode} role="group" aria-label="Export mode">
                     <button disabled={starting} aria-pressed={mode === "combined"} onClick={() => setMode("combined")}>
                        Merged Video
                     </button>
                     <button disabled={starting} aria-pressed={mode === "separate"} onClick={() => setMode("separate")}>
                        Separate clips
                     </button>
                  </div>
               )}
               <label className="field-label" htmlFor="destination">
                  Save to
               </label>
               <div className="folder-field">
                  <input id="destination" value={directory} disabled={starting} onChange={(event) => setDirectory(event.target.value)} />
                  <Button
                     variant="secondary"
                     icon={faFolderOpen}
                     disabled={starting}
                     onClick={() => {
                        void window.desktop
                           .chooseDirectory(directory)
                           .then((path) => {
                              if (path) setDirectory(path);
                           })
                           .catch((value: unknown) => setError(errorText(value)));
                     }}
                  >
                     Browse
                  </Button>
               </div>
               <div>
                  {mode === "combined" && (
                     <label className="field-label combined-name">
                        Filename
                        <div className="filename-field">
                           <input aria-label="Combined filename" value={name} disabled={starting} onChange={(event) => setName(event.target.value)} />
                           <span>{source.exportExtension}</span>
                        </div>
                     </label>
                  )}
               </div>
               {sourceAudio.length === 1 && (
                  <Toggle
                     label="Export audio"
                     checked={audioTracks.length === 1}
                     disabled={starting}
                     onChange={(checked) => setAudioTracks(checked ? [sourceAudio[0]!.index] : [])}
                  />
               )}
               {sourceAudio.length > 1 && (
                  <div className="audio-export-field">
                     <span className="field-label">Audio tracks</span>
                     <DropdownSelect
                        label="Audio tracks to export"
                        options={sourceAudio.map((track, index) => ({ value: String(track.index), label: audioTrackLabel(track, index) }))}
                        value={audioTracks.map(String)}
                        multiple
                        required
                        disabled={starting}
                        onChange={(values) => setAudioTracks(values.map(Number))}
                        trigger={
                           audioTracks.length === sourceAudio.length
                              ? "All audio tracks"
                              : audioTracks.length === 1
                                ? audioTrackLabel(
                                     sourceAudio.find((track) => track.index === audioTracks[0])!,
                                     sourceAudio.findIndex((track) => track.index === audioTracks[0])
                                  )
                                : `${audioTracks.length} audio tracks`
                        }
                     />
                  </div>
               )}
               {clips.length > 1 && (
                  <div className="export-list">
                     <div className="export-list-heading">
                        <span>Clips</span>
                        <span>Duration</span>
                     </div>
                     {rows.map((row, index) => {
                        const extension = exportExtensionFor(source, row.clip, {
                           separate: mode === "separate",
                           allAudio: audioTracks.length === sourceAudio.length,
                        });
                        return (
                           <div key={row.clip.id} className="export-clip-entry">
                              <div className="export-row">
                                 <input
                                    type="checkbox"
                                    aria-label={`Export clip ${index + 1}`}
                                    checked={row.included}
                                    disabled={starting}
                                    onChange={(event) => setRows(rows.map((value, i) => (i === index ? { ...value, included: event.target.checked } : value)))}
                                 />
                                 <span className="color-dot" style={{ background: clipColor(row.clip.color) }} />
                                 {mode === "combined" ? (
                                    <span className="export-clip-name">Clip {index + 1}</span>
                                 ) : (
                                    <input
                                       aria-label={`Clip ${index + 1} filename`}
                                       value={row.name}
                                       disabled={starting}
                                       onChange={(event) => setRows(rows.map((value, i) => (i === index ? { ...value, name: event.target.value } : value)))}
                                    />
                                 )}
                                 <span className="extension">{mode === "separate" ? extension : ""}</span>
                                 <time>{formatTime(row.clip.end - row.clip.start)}</time>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               )}
               {error && (
                  <div className="inline-error" role="alert">
                     {error}
                  </div>
               )}
            </div>
            <div className="modal-footer">
               {analysis && request.items.length > 0 && (
                  <p className={`export-note${problem ? " problem" : ""}`}>
                     <FontAwesomeIcon icon={problem ? faCircleExclamation : faCircleInfo} />
                     <span>
                        {note}{" "}
                        <button
                           className="export-note-link"
                           onClick={() => {
                              onHelp?.("lossless");
                           }}
                        >
                           Learn More
                        </button>
                     </span>
                  </p>
               )}
               <Button
                  variant="primary"
                  icon={faArrowUpFromBracket}
                  disabled={starting || !valid}
                  onClick={() => {
                     void start();
                  }}
               >
                  {starting ? "Exporting…" : mode === "combined" ? "Export video" : selectedCount === 1 ? "Export clip" : `Export ${selectedCount} clips`}
               </Button>
            </div>
         </Modal>
         {confirmationModal}
      </>
   );
}
