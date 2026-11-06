import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMinus, faScissors, faSquare, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { AvailableUpdate } from "../../../shared/types";
import { AppUpdate } from "./AppUpdate";

export function Titlebar({
   platform,
   name,
   dirty,
   path,
   update,
   onError,
}: {
   platform: string;
   name: string;
   dirty: boolean;
   path: string | undefined;
   update: AvailableUpdate | null;
   onError: (message: string) => void;
}) {
   return (
      <div className={`titlebar ${platform === "darwin" ? "mac" : ""}`}>
         <div className="app-mark">
            <FontAwesomeIcon icon={faScissors} />
         </div>
         <span className="app-name">AttaCut</span>
         <span className="title-separator">/</span>
         <span className="title-filename" title={dirty ? "Unsaved project changes" : path}>
            {dirty ? "* " : ""}
            {name}
         </span>
         <AppUpdate update={update} onError={onError} />
         {platform === "win32" && (
            <div className="window-controls">
               <button aria-label="Minimize window" onClick={() => window.desktop.windowAction("minimize")}>
                  <FontAwesomeIcon icon={faMinus} />
               </button>
               <button aria-label="Maximize window" onClick={() => window.desktop.windowAction("maximize")}>
                  <FontAwesomeIcon icon={faSquare} />
               </button>
               <button aria-label="Close window" onClick={() => window.desktop.windowAction("close")}>
                  <FontAwesomeIcon icon={faXmark} />
               </button>
            </div>
         )}
      </div>
   );
}
