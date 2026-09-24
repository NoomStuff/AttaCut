import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpFromBracket, faCircleExclamation, faCheck, faXmark, faFolderOpen, faPlay } from "@fortawesome/free-solid-svg-icons";
import type { ExportJob, JobItem } from "../../../shared/types";
import { Button, IconButton } from "./Controls";
import { errorText } from "../lib/errors";
import { explainExportError } from "../lib/exportErrors";

export function JobProgress({
   job,
   closing,
   onDismiss,
   onError,
   onRetry,
}: {
   job: ExportJob;
   closing: boolean;
   onDismiss: () => void;
   onError: (value: string) => void;
   onRetry: (value: ExportJob) => void;
}) {
   const [hideSuccess, setHideSuccess] = useState(false);
   const [hideFailures, setHideFailures] = useState(false);
   const completed = job.items.filter((item) => item.status === "completed");
   const failures = job.items.filter((item) => item.status === "failed" || item.status === "cancelled");
   const progress = job.items.reduce((sum, item) => sum + item.progress, 0) / job.items.length;
   const dismissSuccess = () => {
      if (!failures.length || hideFailures) onDismiss();
      else setHideSuccess(true);
   };
   const dismissFailures = () => {
      if (!completed.length || hideSuccess) onDismiss();
      else setHideFailures(true);
   };
   const openFirst = (action: "openOutput" | "revealOutput") => {
      const item = completed[0]!;
      void window.desktop[action](item.outputPath).catch((value: unknown) => onError(errorText(value)));
   };
   return (
      <div className="job-notifications" aria-live="polite">
         {job.running && (
            <aside className={`job-progress${closing ? " closing" : ""}`}>
               <div className="job-summary">
                  <span className="job-summary-icon">
                     <FontAwesomeIcon icon={faArrowUpFromBracket} />
                  </span>
                  <div>
                     <strong>{job.items.length === 1 ? "Exporting video" : `Exporting ${completed.length + 1} of ${job.items.length}`}</strong>
                     <small>{job.items.find((item) => item.status === "running")?.name}</small>
                  </div>
               </div>
               <progress max={1} value={progress} />
               <div className="job-actions">
                  <Button onClick={() => void window.desktop.cancelExport()}>Cancel</Button>
               </div>
            </aside>
         )}
         {!job.running && completed.length > 0 && !hideSuccess && (
            <aside className={`job-progress done success${closing ? " closing" : ""}`}>
               <div className="job-summary">
                  <span className="job-summary-icon done">
                     <FontAwesomeIcon icon={faCheck} />
                  </span>
                  <div>
                     <strong>
                        {completed.length === job.items.length
                           ? "Export complete"
                           : completed.length === 1
                             ? "1 file exported"
                             : `${completed.length} files exported`}
                     </strong>
                     <small>{completed.length === 1 ? completed[0]!.name : "Saved and ready to use"}</small>
                  </div>
                  <IconButton icon={faXmark} label="Dismiss export status" onClick={dismissSuccess} />
               </div>
               <div className="job-actions">
                  <Button icon={faPlay} onClick={() => openFirst("openOutput")}>
                     {completed.length === 1 ? "Open file" : "Open first file"}
                  </Button>
                  <Button icon={faFolderOpen} onClick={() => openFirst("revealOutput")}>
                     Show in folder
                  </Button>
               </div>
            </aside>
         )}
         {!job.running && failures.length > 0 && !hideFailures && (
            <aside className={`job-progress failure${closing ? " closing" : ""}`} role="alert">
               <div className="job-summary">
                  <span className="job-summary-icon">
                     <FontAwesomeIcon icon={faCircleExclamation} />
                  </span>
                  <div>
                     <strong>{failures.some((item) => item.status === "failed") ? "Export failed" : "Export cancelled"}</strong>
                     <small>{failures.length === 1 ? "1 file was not exported" : `${failures.length} files were not exported`}</small>
                  </div>
                  <IconButton icon={faXmark} label="Dismiss export errors" onClick={dismissFailures} />
               </div>
               <div className="job-failures">
                  {failures.map((item) => (
                     <Failure key={item.id} item={item} />
                  ))}
               </div>
               <div className="job-actions">
                  <Button
                     onClick={() => {
                        void window.desktop
                           .retryExport(job.id)
                           .then((value) => {
                              setHideSuccess(false);
                              setHideFailures(false);
                              onRetry(value);
                           })
                           .catch((value: unknown) => onError(errorText(value)));
                     }}
                  >
                     Retry files
                  </Button>
               </div>
            </aside>
         )}
      </div>
   );
}

function Failure({ item }: { item: JobItem }) {
   const explanation = item.status === "cancelled" ? "Stopped before this file finished." : explainExportError(item.error);
   return (
      <div className="job-failure-item">
         <b>{item.name}</b>
         <p>{explanation}</p>
         {item.error && item.error !== explanation && item.status !== "cancelled" && (
            <details>
               <summary>Technical details</summary>
               <pre>{item.error}</pre>
            </details>
         )}
      </div>
   );
}
