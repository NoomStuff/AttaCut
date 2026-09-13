import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MediaSource } from "../../../shared/types";
import type { EditDocument } from "../editor/model";
import { selectedClip } from "../editor/model";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
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
import type { Commands } from "../editor/commands";
import { AudioPicker } from "./AudioPicker";
import { pointerSmoothingMs, useSmoothValue } from "../lib/motion";
import { clipColor } from "../editor/colors";

function VolumeSlider({ volume, muted, onChange }: { volume: number; muted: boolean; onChange: (value: number, restore: number) => void }) {
   const gestureVolume = useRef<number | null>(null);
   const displayed = useSmoothValue(muted ? 0 : volume, { follow: pointerSmoothingMs });
   const finish = () => {
      gestureVolume.current = null;
   };
   return (
      <span className="volume-slider" style={{ "--fill": `${displayed * 100}%`, "--volume": displayed } as CSSProperties}>
         <i aria-hidden="true" />
         <input
            type="range"
            aria-label="Preview volume"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onPointerDown={() => {
               gestureVolume.current = volume;
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onKeyDown={() => {
               gestureVolume.current ??= volume;
            }}
            onKeyUp={finish}
            onBlur={finish}
            onChange={(event) => onChange(Number(event.target.value), gestureVolume.current ?? volume)}
         />
      </span>
   );
}

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => number }) {
   const [text, setText] = useState(formatTime(value));
   const cancelled = useRef(false);
   useEffect(() => setText(formatTime(value)), [value]);
   const commit = () => {
      const parsed = cancelled.current ? null : parseTime(text);
      cancelled.current = false;
      const unchanged = text === formatTime(value) || parsed === parseTime(formatTime(value));
      setText(formatTime(parsed === null || unchanged ? value : onChange(parsed)));
   };
   return (
      <label className="time-field">
         <span>{label}</span>
         <input
            aria-label={`Clip ${label.toLowerCase()}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
               if (event.key === "Enter") event.currentTarget.blur();
               if (event.key === "Escape") {
                  cancelled.current = true;
                  setText(formatTime(value));
                  event.currentTarget.blur();
               }
            }}
         />
      </label>
   );
}
export function Transport({
   document,
   source,
   clock,
   playing,
   commands,
   volume,
   muted,
   onVolume,
   onBoundary,
   onFullscreen,
   audioIndex,
   onAudio,
   snapping,
   readingKeys,
   zoom,
}: {
   document: EditDocument;
   source: MediaSource;
   clock: PlaybackClock;
   playing: boolean;
   commands: Commands;
   volume: number;
   muted: boolean;
   onVolume: (value: number, restore: number) => void;
   onBoundary: (side: "start" | "end", value: number) => number;
   onFullscreen: () => void;
   audioIndex: number | null;
   onAudio: (index: number) => void;
   snapping: boolean;
   readingKeys: boolean;
   zoom: number;
}) {
   useClock(clock);
   const clip = selectedClip(document);
   const index = document.clips.findIndex((item) => item.id === document.selectedId);
   return (
      <div className="transport">
         <div className="clip-details">
            {clip ? (
               <>
                  <span className="selected-clip-label">
                     <i style={{ background: clipColor(clip.color) }} />
                     Clip {index + 1}
                     <span className="muted">of {document.clips.length}</span>
                  </span>
                  <div className="clip-boundaries">
                     <TimeField label="Start" value={clip.start} onChange={(value) => onBoundary("start", value)} />
                     <TimeField label="End" value={clip.end} onChange={(value) => onBoundary("end", value)} />
                     <span className="clip-duration">
                        {formatTime(clip.end - clip.start)}
                        <small>duration</small>
                     </span>
                  </div>
               </>
            ) : (
               <span className="muted">Add a clip to keep part of this video.</span>
            )}
         </div>
         <div className="playback-controls">
            <div>
               <IconButton
                  command="previous"
                  icon={faBackwardStep}
                  label="Previous clip"
                  disabled={!commands.previous.enabled()}
                  onClick={commands.previous.run}
               />
               <IconButton
                  command="play"
                  icon={playing ? faPause : faPlay}
                  label={playing ? "Pause" : "Play"}
                  className="play-button"
                  // The playing state rides on a data attribute: rewriting className on every
                  // toggle would wipe the shortcut-flash and press-ripple classes this button
                  // relies on for its feedback animations.
                  data-playing={playing ? "" : undefined}
                  onClick={commands.play.run}
               />
               <IconButton command="next" icon={faForwardStep} label="Next clip" disabled={!commands.next.enabled()} onClick={commands.next.run} />
            </div>
         </div>
         <div className="volume-controls">
            <AudioPicker tracks={source.streams.filter((stream) => stream.type === "audio")} selected={audioIndex} onSelect={onAudio} />
            <IconButton
               command="mute"
               icon={muted || volume === 0 ? faVolumeXmark : faVolumeHigh}
               label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
            />
            <VolumeSlider volume={volume} muted={muted} onChange={onVolume} />
            <span className="control-divider" />
            <div className="zoom-controls" role="group" aria-label="Timeline zoom">
               <IconButton command="zoomOut" icon={faMagnifyingGlassMinus} label="Zoom out" onClick={commands.zoomOut.run} />
               <Button shortcut="" command="fit" className="zoom-percent" aria-label="Fit timeline" onClick={commands.fit.run}>
                  {Math.round(zoom)}%
               </Button>
               <IconButton command="zoomIn" icon={faMagnifyingGlassPlus} label="Zoom in" onClick={commands.zoomIn.run} />
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
            <IconButton icon={faExpand} label="Fullscreen video" onClick={onFullscreen} />
            <IconButton command="settings" icon={faSliders} label="Playback settings" />
         </div>
      </div>
   );
}
