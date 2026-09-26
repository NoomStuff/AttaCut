import { useExport, type ExportOptions } from "../export/useExport";
import type { HelpTab } from "./HelpPanel";
import { useEffect, useState } from "react";
import { exportExtensionFor } from "../../../shared/export-format";
import { formatTime } from "../../../shared/time";
import { faArrowUpFromBracket, faCircleExclamation, faCircleInfo, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, Modal, Toggle } from "./Controls";
import { DropdownSelect } from "./DropdownSelect";
import { errorText } from "../lib/errors";
import { clipColor } from "../editor/colors";
import { audioTrackLabel } from "../playback/audioSelection";

export function ExportPanel(props: ExportOptions & { onHelp?: (topic: HelpTab) => void }) {
   const { source, clips, onClose, onHelp } = props;
   const {
      sourceAudio,
      directory,
      setDirectory,
      mode,
      setMode,
      audioTracks,
      setAudioTracks,
      name,
      setName,
      rows,
      setRows,
      confirmation,
      setConfirmation,
      replaceSourceChecked,
      setReplaceSourceChecked,
      conflicts,
      request,
      error,
      setError,
      starting,
      analysis,
      selectedCount,
      valid,
      start,
   } = useExport(props);
   const confirmationModal = confirmation ? (
      <Modal
         key="confirmation"
         closeDisabled={starting}
         title={
            confirmation.directoryMissing
               ? "Create output folder?"
               : confirmation.sourcePath
                 ? "Replace source video?"
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
                  : confirmation.sourcePath
                    ? `This will replace the video you opened. The original cannot be recovered. The exported video will open when it is ready.${confirmation.existingPaths.length > 1 ? " Other listed files will also be replaced." : ""}`
                    : confirmation.existingPaths.length === 1
                      ? "This file already exists. Exporting will replace it. This cannot be undone."
                      : "These files already exist. Exporting will replace them. This cannot be undone."}
            </p>
            <div className="export-conflicts">
               {confirmation.directoryMissing ? confirmation.directory : confirmation.existingPaths.map((path) => <div key={path}>{path}</div>)}
            </div>
            {confirmation.sourcePath && (
               <label className="export-source-confirm">
                  <input
                     type="checkbox"
                     checked={replaceSourceChecked}
                     disabled={starting}
                     onChange={(event) => setReplaceSourceChecked(event.target.checked)}
                  />
                  I understand this replaces the original video
               </label>
            )}
         </div>
         <div className="modal-footer">
            <Button disabled={starting} onClick={() => setConfirmation(null)}>
               Cancel
            </Button>
            <Button
               variant="danger"
               disabled={starting || (!!confirmation.sourcePath && !replaceSourceChecked)}
               onClick={() => {
                  void start(confirmation);
               }}
            >
               {starting
                  ? "Exporting…"
                  : confirmation.directoryMissing
                    ? "Create folder and export"
                    : confirmation.sourcePath
                      ? "Replace source and export"
                      : "Replace and export"}
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
               <div className="export-mode" data-mode={mode} role="group" aria-label="Export mode" aria-disabled={clips.length === 1}>
                  <button disabled={starting || clips.length === 1} aria-pressed={mode === "combined"} onClick={() => setMode("combined")}>
                     Merged Video
                  </button>
                  <button disabled={starting || clips.length === 1} aria-pressed={mode === "separate"} onClick={() => setMode("separate")}>
                     Separate clips
                  </button>
               </div>
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
                           <span className="export-name-input">
                              <input aria-label="Combined filename" value={name} disabled={starting} onChange={(event) => setName(event.target.value)} />
                              <ConflictIndicator message={conflicts.get("combined") ?? null} />
                           </span>
                           <span className="filename-extension">{source.exportExtension}</span>
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
                        const conflict = mode === "separate" && row.included ? (conflicts.get(row.clip.id) ?? null) : null;
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
                                    <span className="export-row-name-input">
                                       <input
                                          aria-label={`Clip ${index + 1} filename`}
                                          value={row.name}
                                          disabled={starting}
                                          onChange={(event) => setRows(rows.map((value, i) => (i === index ? { ...value, name: event.target.value } : value)))}
                                       />
                                       <ConflictIndicator message={conflict} />
                                    </span>
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

function ConflictIndicator({ message }: { message: string | null }) {
   const [hasAppeared, setHasAppeared] = useState(!!message);
   useEffect(() => {
      if (message) setHasAppeared(true);
   }, [message]);
   return (
      <span
         className="export-conflict-indicator"
         data-state={message ? "visible" : hasAppeared ? "leaving" : "hidden"}
         role="img"
         aria-label={message ?? undefined}
         aria-hidden={!message}
         tabIndex={message ? 0 : -1}
      >
         <FontAwesomeIcon icon={faCircleExclamation} />
         {message && (
            <span className="export-conflict-tooltip" role="tooltip">
               {message}
            </span>
         )}
      </span>
   );
}
