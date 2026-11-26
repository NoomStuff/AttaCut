import { useState } from "react";
import { Button, Modal } from "./Controls";
import { errorText } from "../lib/errors";

/** Says what Report a bug does before two windows open, and what the zip holds. */
export function ReportBugPanel({ onClose }: { onClose: () => void }) {
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState("");
   const report = () => {
      setBusy(true);
      setError("");
      void window.desktop.reportBug().then(onClose, (value: unknown) => {
         setBusy(false);
         setError(errorText(value));
      });
   };
   return (
      <Modal title="Report a bug" onClose={onClose} className="report-bug-modal" closeDisabled={busy}>
         <div className="modal-body report-bug-body">
            <p>AttaCut saves a zip of its logs to Downloads and opens the bug form on GitHub. Drag the zip into the form.</p>
            <p className="report-bug-detail">
               The zip holds what AttaCut did, your system and the open video's codecs. It never holds video, and the names of your videos and exports are
               replaced.
            </p>
            {error && (
               <p className="report-bug-error" role="alert">
                  {error}
               </p>
            )}
         </div>
         <div className="modal-footer">
            <Button onClick={onClose} disabled={busy}>
               Cancel
            </Button>
            <Button variant="primary" onClick={report} disabled={busy}>
               Save logs and open GitHub
            </Button>
         </div>
      </Modal>
   );
}
