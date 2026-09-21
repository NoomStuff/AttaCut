import { useState } from "react";
import { faArrowUpRightFromSquare, faScissors } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { AvailableUpdate } from "../../../shared/types";
import { Button, Modal } from "./Controls";
import "./UpdatePanel.css";

export function UpdatePanel({ update, onClose }: { update: AvailableUpdate; onClose: () => void }) {
   const [ignoreVersion, setIgnoreVersion] = useState(false);
   const dismiss = () => {
      void window.desktop.dismissUpdate(update.version, ignoreVersion).catch(() => {});
      onClose();
   };
   const openRelease = () => {
      void window.desktop.openExternal(update.url).catch(() => {});
      onClose();
   };
   return (
      <Modal
         title="Update available"
         description={`AttaCut ${update.version} is ready to download.`}
         headerIcon={<FontAwesomeIcon icon={faScissors} />}
         onClose={dismiss}
         className="update-modal"
      >
         <div className="modal-footer update-footer">
            <label className="update-ignore">
               <input type="checkbox" checked={ignoreVersion} onChange={(event) => setIgnoreVersion(event.target.checked)} />
               <span aria-hidden="true" />
               Skip this version
            </label>
            <div className="update-actions">
               <Button variant="secondary" onClick={dismiss}>
                  Ignore
               </Button>
               <Button variant="primary" icon={faArrowUpRightFromSquare} onClick={openRelease}>
                  View release
               </Button>
            </div>
         </div>
      </Modal>
   );
}
