import { useEffect, useId, useRef, useState } from "react";
import type { MediaSource } from "../../../shared/types";
import type { EditDocument } from "../editor/model";
import { selectedClip } from "../editor/model";
import { formatTime, parseTime } from "../../../shared/time";
import { Button, IconButton } from "./Controls";
import {
   faPlay,
   faPause,
   faBackwardStep,
   faForwardStep,
   faVolumeHigh,
   faVolumeXmark,
   faSliders,
   faExpand,
   faMagnet,
   faMagnifyingGlassPlus,
   faMagnifyingGlassMinus,
} from "@fortawesome/free-solid-svg-icons";
import { AudioPicker } from "./AudioPicker";
import { VolumeSlider } from "./VolumeSlider";
import { clipColor } from "../editor/colors";

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => number }) {
   const [text, setText] = useState(formatTime(value));
   const [feedback, setFeedback] = useState<string | null>(null);
   const feedbackId = useId();
   const cancelled = useRef(false);
   const focused = useRef(false);
   const dirty = useRef(false);
   const previousValue = useRef(value);
   useEffect(() => {
      if (previousValue.current === value) return;
      previousValue.current = value;
      if (focused.current && dirty.current) return;
      setText(formatTime(value));
   }, [value]);
   useEffect(() => {
      if (!feedback) return;
      const timer = window.setTimeout(() => setFeedback(null), 5000);
      return () => window.clearTimeout(timer);
   }, [feedback]);
   const commit = () => {
      const parsed = cancelled.current ? null : parseTime(text);
      if (!cancelled.current && parsed === null) {
         setText(formatTime(value));
         setFeedback(`${label} unchanged. Enter seconds or a time such as 01:23.45.`);
         dirty.current = false;
         return;
      }
      setFeedback(null);
      cancelled.current = false;
      dirty.current = false;
      const unchanged = [2, 6].some((precision) => text === formatTime(value, precision) || parsed === parseTime(formatTime(value, precision)));
      const actual = parsed === null || unchanged ? value : onChange(parsed);
      setText(formatTime(actual));
   };
   return (
      <label className="time-field">
         <span>{label}</span>
         <input
            aria-label={`Clip ${label.toLowerCase()}`}
            value={text}
            aria-describedby={feedback ? feedbackId : undefined}
            title={formatTime(value, 6)}
            onChange={(event) => {
               setText(event.target.value);
               dirty.current = true;
               setFeedback(null);
            }}
            onFocus={(event) => {
               focused.current = true;
               dirty.current = false;
               event.currentTarget.select();
            }}
            onBlur={() => {
               focused.current = false;
               commit();
            }}
            onKeyDown={(event) => {
               if (event.key === "Enter") event.currentTarget.blur();
               if (event.key === "Escape") {
                  cancelled.current = true;
                  setText(formatTime(value));
                  event.currentTarget.blur();
               }
            }}
         />
         {feedback && (
            <span id={feedbackId} className="time-feedback" role="status">
               {feedback}
            </span>
         )}
      </label>
   );
}
export function Transport({
   document,
   source,
   playing,
   volume,
   muted,
   onVolume,
   onBoundary,
   onFullscreen,
   onSettings,
   audioIndices,
   onAudio,
   snapping,
   readingKeys,
   zoom,
}: {
   document: EditDocument;
   source: MediaSource;
   playing: boolean;
   volume: number;
   muted: boolean;
   onVolume: (value: number, restore: number) => void;
   onBoundary: (side: "start" | "end", value: number) => number;
   onFullscreen: () => void;
   onSettings: () => void;
   audioIndices: number[];
   onAudio: (indices: number[]) => void;
   snapping: boolean;
   readingKeys: boolean;
   zoom: number;
}) {
   const clip = selectedClip(document);
   const index = document.clips.findIndex((item) => item.id === document.selectedId);
   return (
      <div className="transport">
         <div className="clip-details">
            {clip ? (
               <>
                  <span className="selected-clip-label">
                     <i style={{ background: clipColor(clip.color) }} />
                     {document.clips.length === 1 ? "Clip" : `Clip ${index + 1}`}
                     {document.clips.length > 1 && <span className="muted">of {document.clips.length}</span>}
                  </span>
                  <div className="clip-boundaries">
                     <TimeField key={`${clip.id}:start`} label="Start" value={clip.start} onChange={(value) => onBoundary("start", value)} />
                     <TimeField key={`${clip.id}:end`} label="End" value={clip.end} onChange={(value) => onBoundary("end", value)} />
                     <span className="clip-duration">
                        {formatTime(clip.end - clip.start)}
                        <small>duration</small>
                     </span>
                  </div>
               </>
            ) : (
               <span className="muted">Add a clip to keep this part of the video.</span>
            )}
         </div>
         <div className="playback-controls">
            <div>
               <IconButton command="previous" icon={faBackwardStep} label="Previous cut" />
               <IconButton
                  command="play"
                  icon={playing ? faPause : faPlay}
                  label={playing ? "Pause" : "Play"}
                  className="play-button"
                  // The playing state rides on a data attribute: rewriting className on every
                  // toggle would wipe the shortcut-flash and press-ripple classes this button
                  // relies on for its feedback animations.
                  data-playing={playing ? "" : undefined}
               />
               <IconButton command="next" icon={faForwardStep} label="Next cut" />
            </div>
         </div>
         <div className="volume-controls">
            <AudioPicker tracks={source.streams.filter((stream) => stream.type === "audio")} selected={audioIndices} onSelect={onAudio} />
            <IconButton
               command="mute"
               icon={muted || volume === 0 ? faVolumeXmark : faVolumeHigh}
               label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
            />
            <VolumeSlider volume={volume} muted={muted} onChange={onVolume} />
            <span className="control-divider" />
            <div className="zoom-controls" role="group" aria-label="Timeline zoom">
               <IconButton command="zoomOut" icon={faMagnifyingGlassMinus} label="Zoom out" />
               <Button shortcut="" command="fit" className="zoom-percent" aria-label="Fit timeline">
                  {Math.round(zoom)}%
               </Button>
               <IconButton command="zoomIn" icon={faMagnifyingGlassPlus} label="Zoom in" />
            </div>
            <span className="control-divider" />
            <IconButton
               command="snap"
               icon={faMagnet}
               label="Snap to keyframes"
               active={snapping}
               aria-pressed={snapping}
               aria-busy={readingKeys}
               disabled={readingKeys}
            />
            <IconButton command="fullscreen" icon={faExpand} label="Fullscreen video" onClick={onFullscreen} />
            <IconButton icon={faSliders} label="Settings" onClick={onSettings} shortcutFrom="options" />
         </div>
      </div>
   );
}
