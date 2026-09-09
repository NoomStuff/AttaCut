import { useEffect, useRef, useState } from "react";
import type { MediaSource, Preferences } from "../../../shared/types";
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
import { bindingFor, displayBinding } from "../editor/commands";
import { AudioPicker } from "./AudioPicker";

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
   preferences,
   mac,
   volume,
   muted,
   onMute,
   onVolume,
   onSettings,
   onBoundary,
   onFullscreen,
   audioIndex,
   onAudio,
   snapping,
   readingKeys,
   onSnap,
   zoom,
}: {
   document: EditDocument;
   source: MediaSource;
   clock: PlaybackClock;
   playing: boolean;
   commands: Commands;
   preferences: Preferences;
   mac: boolean;
   volume: number;
   muted: boolean;
   onMute: () => void;
   onVolume: (value: number) => void;
   onSettings: () => void;
   onBoundary: (side: "start" | "end", value: number) => number;
   onFullscreen: () => void;
   audioIndex: number | null;
   onAudio: (index: number) => void;
   snapping: boolean;
   readingKeys: boolean;
   onSnap: () => void;
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
                     <i style={{ background: `var(--clip-${clip.color % 6})` }} />
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
               <IconButton icon={faBackwardStep} label="Previous clip" disabled={!commands.previous.enabled()} onClick={commands.previous.run} />
               <IconButton
                  icon={playing ? faPause : faPlay}
                  label={playing ? "Pause" : "Play"}
                  shortcut={displayBinding(bindingFor("play", preferences.shortcuts), mac)}
                  className="play-button"
                  onClick={commands.play.run}
               />
               <IconButton icon={faForwardStep} label="Next clip" disabled={!commands.next.enabled()} onClick={commands.next.run} />
            </div>
         </div>
         <div className="volume-controls">
            <AudioPicker tracks={source.streams.filter((stream) => stream.type === "audio")} selected={audioIndex} onSelect={onAudio} />
            <IconButton icon={muted || volume === 0 ? faVolumeXmark : faVolumeHigh} label={muted ? "Unmute preview" : "Mute preview"} onClick={onMute} />
            <input
               type="range"
               aria-label="Preview volume"
               min={0}
               max={1}
               step={0.01}
               value={muted ? 0 : volume}
               onChange={(event) => onVolume(Number(event.target.value))}
            />
            <span className="control-divider" />
            <div className="zoom-controls" role="group" aria-label="Timeline zoom">
               <IconButton icon={faMagnifyingGlassMinus} label="Zoom out" onClick={commands.zoomOut.run} />
               <Button className="zoom-percent" aria-label="Fit timeline" onClick={commands.fit.run}>
                  {Math.round(zoom)}%
               </Button>
               <IconButton icon={faMagnifyingGlassPlus} label="Zoom in" onClick={commands.zoomIn.run} />
            </div>
            <span className="control-divider" />
            <IconButton
               icon={faMagnet}
               label="Snap to keyframes"
               active={snapping}
               aria-pressed={snapping}
               aria-busy={readingKeys}
               disabled={readingKeys}
               onClick={onSnap}
            />
            <IconButton icon={faExpand} label="Fullscreen video" onClick={onFullscreen} />
            <IconButton icon={faSliders} label="Playback settings" onClick={onSettings} />
         </div>
      </div>
   );
}
