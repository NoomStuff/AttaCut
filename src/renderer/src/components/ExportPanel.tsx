import { useState } from "react";
import type { Clip, ExportJob, MediaSource, Preferences } from "../../../shared/types";
import { exportExtensionFor } from "../../../shared/types";
import { formatTime } from "../../../shared/time";
import { faArrowUpFromBracket, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import { Button, Modal, Toggle } from "./Controls";
import { errorText } from "../lib/errors";
import { clipColor } from "../editor/colors";

export function ExportPanel({
   source,
   clips,
   preferences,
   onPreferences,
   onClose,
   onStarted,
}: {
   source: MediaSource;
   clips: Clip[];
   preferences: Preferences;
   onPreferences: (value: Preferences) => void;
   onClose: () => void;
   onStarted: (job: ExportJob) => void;
}) {
   const [directory, setDirectory] = useState(preferences.outputDirectory || source.directory);
   const [mode, setMode] = useState<Preferences["exportMode"]>(clips.length === 1 ? "combined" : preferences.exportMode);
   const [muteAudio, setMuteAudio] = useState(preferences.exportMuted);
   const [name, setName] = useState(`${source.name.slice(0, -source.extension.length)} (Trim)`);
   const [rows, setRows] = useState(() =>
      clips.map((clip, index) => ({
         clip,
         included: true,
         name: `${source.name.slice(0, -source.extension.length)} (${index + 1})`,
      }))
   );
   const request = {
      sourceId: source.id,
      directory,
      mode: mode,
      muteAudio,
      name,
      items: rows.filter((row) => row.included).map((row, index) => ({ clip: row.clip, name: mode === "combined" ? `Clip ${index + 1}` : row.name })),
   };
   const [error, setError] = useState<string | null>(null);
   const [starting, setStarting] = useState(false);
   const valid = request.items.length > 0 && !!directory.trim() && (mode === "combined" ? !!name.trim() : request.items.every((item) => !!item.name.trim()));
   const start = async () => {
      if (!valid || starting) return;
      setStarting(true);
      setError(null);
      try {
         const plan = await window.desktop.planExport(request);
         const unsupported = plan.items.find((item) => item.method === "unsupported");
         if (unsupported) throw new Error(unsupported.message);
         const job = await window.desktop.startExport(plan.id);
         onPreferences({ ...preferences, outputDirectory: directory, exportMode: mode, exportMuted: muteAudio });
         onStarted(job);
         onClose();
      } catch (value) {
         setError(errorText(value));
         setStarting(false);
      }
   };
   const selectedCount = request.items.length;
   return (
      <Modal
         title="Export clips"
         onClose={() => {
            if (!starting) onClose();
         }}
         className="export-modal"
      >
         <div className="modal-body">
            <div className="export-mode" data-mode={mode} role="group" aria-label="Export mode">
               <button disabled={starting} aria-pressed={mode === "combined"} onClick={() => setMode("combined")}>
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
                  icon={faFolderOpen}
                  disabled={starting}
                  onClick={() => {
                     void window.desktop.chooseDirectory(directory).then((path) => {
                        if (path) setDirectory(path);
                     });
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
            <Toggle label="Mute audio" checked={muteAudio} disabled={starting} onChange={setMuteAudio} />
            <div className="export-list">
               <div className="export-list-heading">
                  <span>Clips</span>
                  <span>Duration</span>
               </div>
               {rows.map((row, index) => {
                  const extension = exportExtensionFor(source, row.clip, { separate: mode === "separate", muteAudio });
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
            {error && (
               <div className="inline-error" role="alert">
                  {error}
               </div>
            )}
         </div>
         <div className="modal-footer">
            <Button
               variant="primary"
               icon={faArrowUpFromBracket}
               disabled={starting || !valid}
               onClick={() => {
                  void start();
               }}
            >
               {starting ? "Exporting…" : mode === "combined" ? "Export video" : `Export ${selectedCount} ${selectedCount === 1 ? "clip" : "clips"}`}
            </Button>
         </div>
      </Modal>
   );
}
