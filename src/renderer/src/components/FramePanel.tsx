import { useState } from "react";
import type { MediaSource, Preferences } from "../../../shared/types";
import { formatTime } from "../../../shared/time";
import { Button, Modal } from "./Controls";
import { errorText } from "./ExportPanel";
import { faFolderOpen, faCamera } from "@fortawesome/free-solid-svg-icons";

export function FramePanel({
   source,
   time,
   preferences,
   onPreferences,
   onClose,
}: {
   source: MediaSource;
   time: number;
   preferences: Preferences;
   onPreferences: (value: Preferences) => void;
   onClose: () => void;
}) {
   const [capturedTime] = useState(time);
   const [directory, setDirectory] = useState(preferences.outputDirectory || source.directory);
   const [name, setName] = useState(`${source.name.slice(0, -source.extension.length)}-${formatTime(time).replaceAll(":", "-")}`);
   const [format, setFormat] = useState(preferences.frameFormat);
   const [quality, setQuality] = useState(preferences.frameQuality);
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [saved, setSaved] = useState<string | null>(null);
   const save = async () => {
      setBusy(true);
      setError(null);
      try {
         const path = await window.desktop.exportFrame({ sourceId: source.id, time: capturedTime, directory, name, format, quality });
         onPreferences({ ...preferences, outputDirectory: directory, frameFormat: format, frameQuality: quality });
         setSaved(path);
      } catch (value) {
         setError(errorText(value));
      } finally {
         setBusy(false);
      }
   };
   return (
      <Modal
         title="Export current frame"
         description={formatTime(capturedTime)}
         onClose={() => {
            if (!busy) onClose();
         }}
         className="frame-modal"
      >
         <div className="modal-body export-body">
            <label className="field-label">
               Save to
               <div className="directory-field">
                  <input aria-label="Save frame to" value={directory} onChange={(event) => setDirectory(event.target.value)} />
                  <Button
                     icon={faFolderOpen}
                     onClick={() => {
                        void window.desktop
                           .chooseDirectory(directory)
                           .then((value) => {
                              if (value) setDirectory(value);
                           })
                           .catch((value) => setError(errorText(value)));
                     }}
                  >
                     Browse
                  </Button>
               </div>
            </label>
            <label className="field-label">
               Filename
               <input aria-label="Frame filename" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field-label">
               Format
               <select aria-label="Image format" value={format} onChange={(event) => setFormat(event.target.value as "png" | "jpg")}>
                  <option value="png">PNG</option>
                  <option value="jpg">JPEG</option>
               </select>
            </label>
            {format === "jpg" && (
               <label className="field-label">
                  Quality {quality}
                  <input
                     aria-label="Image quality"
                     type="range"
                     min="1"
                     max="100"
                     value={quality}
                     onChange={(event) => setQuality(Number(event.target.value))}
                  />
               </label>
            )}
            {source.streams.some((stream) => ["smpte2084", "arib-std-b67"].includes(stream.colorTransfer)) && (
               <p className="muted">HDR is converted to standard color for this image.</p>
            )}
            {error && (
               <div role="alert" className="inline-error">
                  {error}
               </div>
            )}
            {saved && <p role="status">Frame exported</p>}
         </div>
         <div className="modal-footer">
            {saved && (
               <Button
                  onClick={() => {
                     void window.desktop.revealOutput(saved).catch((value) => setError(errorText(value)));
                  }}
               >
                  Show file
               </Button>
            )}
            <Button
               variant="primary"
               icon={faCamera}
               disabled={busy || !name.trim() || !directory.trim()}
               onClick={() => {
                  void save();
               }}
            >
               {busy ? "Exporting…" : "Export frame"}
            </Button>
         </div>
      </Modal>
   );
}
