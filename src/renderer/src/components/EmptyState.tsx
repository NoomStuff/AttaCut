import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faScissors, faFolderOpen, faArrowRight } from "@fortawesome/free-solid-svg-icons";
import { Button } from "./Controls";

const HERO_HOLES = [15, 27, 39, 51, 63, 75, 87];
const HERO_HOLES_RIGHT = [104, 116, 128];

export function EmptyState({ onImport, loading, mac }: { onImport: () => void; loading: boolean; mac: boolean }) {
   return (
      <div className="empty-state">
         <div className="empty-hero" aria-hidden="true">
            <svg viewBox="0 0 148 76" width="148" height="76">
               <g>
                  <rect className="hero-body" x="8" y="22" width="90" height="36" rx="7" />
                  {HERO_HOLES.map((x) => (
                     <rect key={`lt${x}`} className="hero-hole" x={x} y="26.5" width="5" height="4.5" rx="1.5" />
                  ))}
                  {HERO_HOLES.map((x) => (
                     <rect key={`lb${x}`} className="hero-hole" x={x} y="49" width="5" height="4.5" rx="1.5" />
                  ))}
               </g>
               <g className="hero-piece">
                  <g className="hero-piece-inner">
                     <rect className="hero-body kept" x="98" y="22" width="42" height="36" rx="7" />
                     {HERO_HOLES_RIGHT.map((x) => (
                        <rect key={`rt${x}`} className="hero-hole" x={x} y="26.5" width="5" height="4.5" rx="1.5" />
                     ))}
                     {HERO_HOLES_RIGHT.map((x) => (
                        <rect key={`rb${x}`} className="hero-hole" x={x} y="49" width="5" height="4.5" rx="1.5" />
                     ))}
                  </g>
               </g>
               <line className="hero-cut" x1="98" y1="5" x2="98" y2="71" />
            </svg>
            <span className="hero-scissors">
               <FontAwesomeIcon icon={faScissors} />
            </span>
         </div>
         <h1>Cut your clips, move on.</h1>
         <p>Drag & drop or import a video file.</p>
         <Button icon={faFolderOpen} variant="primary" onClick={onImport} disabled={loading}>
            Import video <FontAwesomeIcon icon={faArrowRight} />
         </Button>
         <span className="empty-shortcut">
            or use <kbd>{mac ? "⌘" : "Ctrl"}</kbd> <kbd>O</kbd>
         </span>
         <div className="empty-timeline" aria-hidden="true">
            <i className="empty-track" />
            <span className="empty-clip c0" />
            <span className="empty-clip c1" />
            <span className="empty-clip c2" />
            <span className="empty-playhead" />
         </div>
      </div>
   );
}
