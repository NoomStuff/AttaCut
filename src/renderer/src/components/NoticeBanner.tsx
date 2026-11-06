import type { ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleExclamation, faCircleInfo, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { EditorNotice } from "../editor/useEditorSession";
import { useExitValue } from "../lib/motion";

const icons = { error: faCircleExclamation, warning: faTriangleExclamation, info: faCircleInfo };

/** Errors interrupt work and get the red banner; warnings and info explain a recoverable state. */
export function NoticeBanner({ notice, action, onDismiss }: { notice: EditorNotice | null; action?: ReactNode; onDismiss: () => void }) {
   const presence = useExitValue(notice, 190);
   if (!presence.mounted || !presence.value) return null;
   const { tone, text } = presence.value;
   return (
      <div className={`error-wrap${presence.closing ? " closing" : ""}`}>
         <div className={`error-banner${tone === "error" ? "" : ` ${tone}`}`} role={tone === "error" ? "alert" : "status"}>
            <FontAwesomeIcon icon={icons[tone]} />
            <span>{text}</span>
            {action}
            <button aria-label="Dismiss error" onClick={onDismiss}>
               <FontAwesomeIcon icon={faXmark} />
            </button>
         </div>
      </div>
   );
}
