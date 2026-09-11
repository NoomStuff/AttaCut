import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpFromBracket, faCircleExclamation, faCheck, faXmark, faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import type { ExportJob } from "../../../shared/types";
import { Button, IconButton } from "./Controls";
import { errorText } from "../lib/errors";

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
   const complete = job.items.filter((item) => item.status === "completed").length;
   const failures = job.items.filter((item) => item.status === "failed" || item.status === "cancelled");
   const progress = job.items.reduce((sum, item) => sum + item.progress, 0) / job.items.length;
   return (
      <aside className={`job-progress${job.running ? "" : " done"}${closing ? " closing" : ""}`} aria-live="polite">
         <div className="job-summary">
            <span className={`job-summary-icon${job.running ? "" : " done"}`}>
               <FontAwesomeIcon icon={job.running ? faArrowUpFromBracket : failures.length ? faCircleExclamation : faCheck} />
            </span>
            <div>
               <strong>{job.running ? `Exporting ${complete + 1} of ${job.items.length}` : `${complete} ${complete === 1 ? "clip" : "clips"} exported`}</strong>
               <small>
                  {job.running
                     ? job.items.find((item) => item.status === "running")?.name
                     : failures.length
                       ? `${failures.length} unfinished`
                       : "Saved and ready to use"}
               </small>
            </div>
            {!job.running && <IconButton icon={faXmark} label="Dismiss export status" onClick={onDismiss} />}
         </div>
         {job.running && <progress max={1} value={progress} />}
         {failures.length > 0 && (
            <details>
               <summary>Export details</summary>
               {failures.map((item) => (
                  <p key={item.id}>
                     {item.name}: {item.error ?? item.status}
                  </p>
               ))}
            </details>
         )}
         <div className="job-actions">
            {job.running ? (
               <Button
                  onClick={() => {
                     void window.desktop.cancelExport();
                  }}
               >
                  Cancel
               </Button>
            ) : (
               <>
                  {failures.length > 0 && (
                     <Button
                        onClick={() => {
                           void window.desktop
                              .retryExport(job.id)
                              .then(onRetry)
                              .catch((value: unknown) => onError(errorText(value)));
                        }}
                     >
                        Retry unfinished
                     </Button>
                  )}
                  <Button
                     icon={faFolderOpen}
                     onClick={() => {
                        void window.desktop.revealOutput(job.directory).catch((value: unknown) => onError(errorText(value)));
                     }}
                  >
                     Open folder
                  </Button>
               </>
            )}
         </div>
      </aside>
   );
}
