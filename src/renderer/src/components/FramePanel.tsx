import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { MediaSource, Preferences } from "../../../shared/types";
import { formatTime } from "../../../shared/time";
import { Button, Modal } from "./Controls";
import { errorText } from "../lib/errors";
import { faCamera } from "@fortawesome/free-solid-svg-icons";
import { OutputDirectoryField } from "./OutputDirectoryField";
import { DropdownSelect } from "./DropdownSelect";

export function FramePanel({
   source,
   time,
   videoRef,
   preferences,
   onPreferences,
   onClose,
}: {
   source: MediaSource;
   time: number;
   videoRef: RefObject<HTMLVideoElement | null>;
   preferences: Preferences;
   onPreferences: (value: Preferences) => void;
   onClose: () => void;
}) {
   const [capturedTime] = useState(time);
   const thumbnailRef = useRef<HTMLCanvasElement>(null);
   const [thumbnail, setThumbnail] = useState(false);
   useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      const capture = () => {
         if (video.seeking || video.readyState < 2 || !video.videoWidth) return;
         const canvas = thumbnailRef.current;
         if (!canvas) return;
         const scale = Math.min(1, 320 / video.videoWidth, 180 / video.videoHeight);
         canvas.width = Math.round(video.videoWidth * scale);
         canvas.height = Math.round(video.videoHeight * scale);
         try {
            const context = canvas.getContext("2d");
            if (!context) return;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            setThumbnail(true);
         } catch {
            // Export remains available when a preview cannot be captured.
         }
      };
      capture();
      video.addEventListener("seeked", capture);
      video.addEventListener("loadeddata", capture);
      return () => {
         video.removeEventListener("seeked", capture);
         video.removeEventListener("loadeddata", capture);
      };
   }, [videoRef]);
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
      setSaved(null);
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
         closeDisabled={busy}
         description={formatTime(capturedTime)}
         onClose={() => {
            if (!busy) onClose();
         }}
         className="frame-modal"
      >
         <div className="modal-body export-body">
            <label className="field-label">
               Save to
               <OutputDirectoryField
                  label="Save frame to"
                  className="directory-field"
                  value={directory}
                  disabled={busy}
                  onChange={(value) => {
                     setSaved(null);
                     setDirectory(value);
                  }}
                  onError={(value) => setError(errorText(value))}
               />
            </label>
            <div className={`frame-preview-row${thumbnail ? " has-thumbnail" : ""}`}>
               <canvas ref={thumbnailRef} className="frame-thumbnail" hidden={!thumbnail} role="img" aria-label={`Frame at ${formatTime(capturedTime)}`} />
               <label className="field-label">
                  Filename
                  <input
                     aria-label="Frame filename"
                     disabled={busy}
                     value={name}
                     onChange={(event) => {
                        setSaved(null);
                        setName(event.target.value);
                     }}
                  />
               </label>
            </div>
            <div className="field-label">
               Format
               <DropdownSelect
                  label="Image format"
                  disabled={busy}
                  options={[
                     { value: "png", label: "PNG" },
                     { value: "jpg", label: "JPEG" },
                  ]}
                  value={[format]}
                  onChange={([value]) => {
                     setSaved(null);
                     setFormat(value as "png" | "jpg");
                  }}
                  trigger={format === "png" ? "PNG" : "JPEG"}
               />
            </div>
            {format === "jpg" && (
               <label className="field-label">
                  Quality {quality}
                  <input
                     aria-label="Image quality"
                     disabled={busy}
                     type="range"
                     min="1"
                     max="100"
                     value={quality}
                     onChange={(event) => {
                        setSaved(null);
                        setQuality(Number(event.target.value));
                     }}
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
                  variant="secondary"
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
