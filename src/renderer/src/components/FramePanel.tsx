import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { MediaSource, Preferences } from "../../../shared/types";
import { formatTime } from "../../../shared/time";
import { Button, Modal } from "./Controls";
import { errorText } from "../lib/errors";
import { faCamera } from "@fortawesome/free-solid-svg-icons";
import { OutputDirectoryField } from "./OutputDirectoryField";
import { DropdownSelect } from "./DropdownSelect";
import type { PlaybackClock } from "../playback/clock";
import type { PlaybackSeeker } from "../playback/seeker";

export function FramePanel({
   source,
   clock,
   seeker,
   videoRef,
   preferences,
   onPreferences,
   onClose,
}: {
   source: MediaSource;
   clock: PlaybackClock;
   seeker: PlaybackSeeker;
   videoRef: RefObject<HTMLVideoElement | null>;
   preferences: Preferences;
   onPreferences: (value: Preferences) => void;
   onClose: () => void;
}) {
   const [capturedTime, setCapturedTime] = useState<number | null>(null);
   const [name, setName] = useState("");
   const thumbnailRef = useRef<HTMLCanvasElement>(null);
   const [thumbnail, setThumbnail] = useState(false);
   useEffect(() => {
      const video = videoRef.current;
      let time: number | null = null;
      let captured = false;
      const capture = () => {
         if (captured || seeker.getWaiting() || video?.seeking) return;
         if (time === null) {
            time = clock.currentFrame(video, false);
            setCapturedTime(time);
            setName(`${source.name.slice(0, -source.extension.length)}-${formatTime(time).replaceAll(":", "-")}`);
         }
         if (!video || video.readyState < 2 || !video.videoWidth) return;
         captured = true;
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
      const unsubscribe = seeker.subscribeWaiting(capture);
      video?.addEventListener("seeked", capture);
      video?.addEventListener("loadeddata", capture);
      return () => {
         unsubscribe();
         video?.removeEventListener("seeked", capture);
         video?.removeEventListener("loadeddata", capture);
      };
   }, [videoRef, clock, seeker, source]);
   const [directory, setDirectory] = useState(preferences.outputDirectory || source.directory);
   const [format, setFormat] = useState(preferences.frameFormat);
   const [quality, setQuality] = useState(preferences.frameQuality);
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const save = async () => {
      if (capturedTime === null) return;
      setBusy(true);
      setError(null);
      try {
         await window.desktop.exportFrame({ sourceId: source.id, time: capturedTime, directory, name, format, quality });
         onPreferences({ ...preferences, outputDirectory: directory, frameFormat: format, frameQuality: quality });
         onClose();
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
         description={capturedTime === null ? "Loading frame..." : formatTime(capturedTime)}
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
                     setDirectory(value);
                  }}
                  onError={(value) => setError(errorText(value))}
               />
            </label>
            <div className={`frame-preview-row${thumbnail ? " has-thumbnail" : ""}`}>
               <canvas
                  ref={thumbnailRef}
                  className="frame-thumbnail"
                  hidden={!thumbnail}
                  role="img"
                  aria-label={capturedTime === null ? "Frame preview" : `Frame at ${formatTime(capturedTime)}`}
               />
               <label className="field-label">
                  Filename
                  <input
                     aria-label="Frame filename"
                     disabled={busy}
                     value={name}
                     onChange={(event) => {
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
         </div>
         <div className="modal-footer">
            <Button
               variant="primary"
               icon={faCamera}
               disabled={busy || capturedTime === null || !name.trim() || !directory.trim()}
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
