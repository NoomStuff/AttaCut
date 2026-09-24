import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faBackwardStep,
   faExpand,
   faForwardStep,
   faMagnet,
   faMagnifyingGlassMinus,
   faMagnifyingGlassPlus,
   faPlay,
   faSliders,
   faVolumeHigh,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

function Control({ icon, label, className = "" }: { icon: IconDefinition; label: string; className?: string }) {
   return (
      <button type="button" className={`icon-button ${className}`} aria-label={label} disabled>
         <FontAwesomeIcon icon={icon} />
      </button>
   );
}

export function LoadingEditor() {
   return (
      <>
         <div className="loading-preview skeleton" />
         <div className="editor-dock loading-editor-dock" aria-hidden="true">
            <div className="loading-editor-timeline">
               <div className="loading-editor-ruler">
                  <span>00:00</span>
                  <span>--:--</span>
               </div>
               <div className="loading-editor-track skeleton" />
            </div>
            <div className="transport loading-editor-transport">
               <div className="clip-details">
                  <span className="selected-clip-label">
                     <i /> Clip
                  </span>
                  <div className="clip-boundaries">
                     <span className="time-field">
                        Start <em className="skeleton" />
                     </span>
                     <span className="time-field">
                        End <em className="skeleton" />
                     </span>
                  </div>
               </div>
               <div className="playback-controls">
                  <div>
                     <Control icon={faBackwardStep} label="Previous clip" />
                     <Control icon={faPlay} label="Play" className="play-button" />
                     <Control icon={faForwardStep} label="Next clip" />
                  </div>
               </div>
               <div className="volume-controls">
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
