import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faBackwardStep,
   faExpand,
   faForwardStep,
   faHeadphones,
   faMagnet,
   faMagnifyingGlassMinus,
   faMagnifyingGlassPlus,
   faPlay,
   faSliders,
   faVolumeHigh,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { CSSProperties } from "react";
import type { Clip } from "../../../shared/editing";
import { formatTime } from "../../../shared/time";
import { clipColor } from "../editor/colors";
import type { OpeningEditor } from "../editor/useEditorSession";

function Control({ icon, label, className = "" }: { icon: IconDefinition; label: string; className?: string }) {
   return (
      <button type="button" className={`icon-button ${className}`} aria-label={label} disabled>
         <FontAwesomeIcon icon={icon} />
      </button>
   );
}

/** Stands in for a time the loading editor can't know yet, at about the width of a real one. */
const unknownTime = "-:--.--";

/**
 * The editor as it will look once the file opens, drawn with the real timeline and transport
 * styles so the swap to the live editor doesn't move anything. Only what is already known is
 * shown: a new video is one clip across all of it, and a restored session or project has its cuts.
 */
export function LoadingEditor({ label, opening }: { label: string; opening: OpeningEditor | null }) {
   const cuts = opening?.cuts ?? null;
   const whole = cuts === "whole";
   const clips: Clip[] = whole ? [{ id: "whole", start: 0, end: 1, color: 0 }] : (cuts?.clips ?? []);
   const selectedId = whole ? "whole" : (cuts?.selectedId ?? null);
   const duration = opening?.duration ?? null;
   // Older sessions didn't record the length. Their last cut is the best guess at the scale.
   const span = whole ? 1 : duration || Math.max(0, ...clips.map((clip) => clip.end)) || 1;
   const selected = clips.find((clip) => clip.id === selectedId);
   const index = selected ? clips.indexOf(selected) : -1;
   // A new video's end is its length, which only the probe knows.
   const time = (value: number) => (whole && value > 0 ? unknownTime : formatTime(value));
   const percent = (value: number) => `${(Math.min(value, span) / span) * 100}%`;
   const width = (clip: Clip) => `${((Math.min(clip.end, span) - Math.min(clip.start, span)) / span) * 100}%`;
   return (
      <>
         <div className="loading-preview">{label}</div>
         <div className="editor-dock loading-editor-dock" aria-hidden="true">
            <section className="timeline-section">
               <div className="timeline-viewport">
                  <div className="timeline-ruler">
                     <span className="ruler-tick major edge-start" style={{ left: 0 }}>
                        <em>0:00</em>
                     </span>
                     {duration !== null && (
                        <span className="ruler-tick major edge-end" style={{ left: "100%" }}>
                           <em>{formatTime(duration, 0)}</em>
                        </span>
                     )}
                  </div>
                  <div className="timeline-track">
                     <div className="excluded-track" />
                     {clips.map((clip, position) => (
                        <div
                           key={clip.id}
                           className={`clip-range${clip.id === selectedId ? " selected" : ""}`}
                           style={
                              {
                                 left: percent(clip.start),
                                 width: width(clip),
                                 "--clip-color": clipColor(clip.color),
                              } as CSSProperties
                           }
                        >
                           <span className="clip-number">{String(position + 1).padStart(2, "0")}</span>
                           <span className="trim-handle start" />
                           <span className="trim-handle end" />
                        </div>
                     ))}
                  </div>
                  <div className="playhead" style={{ left: 0 }}>
                     <span />
                     <i />
                  </div>
                  <div className="timeline-time">
                     <time>{formatTime(0)}</time>
                     <span>/</span>
                     <time>{duration === null ? unknownTime : formatTime(duration)}</time>
                  </div>
               </div>
            </section>
            <div className="transport loading-editor-transport">
               <div className="clip-details">
                  {selected && (
                     <>
                        <span className="selected-clip-label">
                           <i style={{ background: clipColor(selected.color) }} />
                           {clips.length === 1 ? "Clip" : `Clip ${index + 1}`}
                           {clips.length > 1 && <span className="muted">of {clips.length}</span>}
                        </span>
                        <div className="clip-boundaries">
                           <span className="time-field">
                              <span>Start</span>
                              <input value={time(selected.start)} readOnly tabIndex={-1} />
                           </span>
                           <span className="time-field">
                              <span>End</span>
                              <input value={time(selected.end)} readOnly tabIndex={-1} />
                           </span>
                           <span className="clip-duration">
                              <small>Duration</small>
                              <time>{whole ? unknownTime : formatTime(selected.end - selected.start)}</time>
                           </span>
                        </div>
                     </>
                  )}
               </div>
               <div className="playback-controls">
                  <div>
                     <Control icon={faBackwardStep} label="Previous cut" />
                     <Control icon={faPlay} label="Play" className="play-button" />
                     <Control icon={faForwardStep} label="Next cut" />
                  </div>
               </div>
               <div className="volume-controls">
                  {/* Slot for the audio picker, which stays mounted but disabled for single-track sources. */}
                  <Control icon={faHeadphones} label="Preview audio tracks" />
                  <Control icon={faVolumeHigh} label="Preview volume" />
                  <span className="loading-editor-volume-slider" />
                  <span className="control-divider" />
                  <div className="zoom-controls">
                     <Control icon={faMagnifyingGlassMinus} label="Zoom out" />
                     <button type="button" className="button quiet zoom-percent" disabled>
                        100%
                     </button>
                     <Control icon={faMagnifyingGlassPlus} label="Zoom in" />
                  </div>
                  <span className="control-divider" />
                  <Control icon={faMagnet} label="Snap to keyframes" />
                  <Control icon={faExpand} label="Fullscreen video" />
                  <Control icon={faSliders} label="Playback settings" />
               </div>
            </div>
         </div>
      </>
   );
}
