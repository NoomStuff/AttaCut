import { useEffect, useMemo, useState } from "react";
import type { MediaSource } from "../../../shared/media";
import { formatTime } from "../../../shared/time";
import { splitAtSceneCuts, type EditDocument } from "../editor/model";
import { errorText } from "../lib/errors";
import { Button, Modal } from "./Controls";
import { SegmentedControl } from "./SegmentedControl";
import { faScissors } from "@fortawesome/free-solid-svg-icons";

import "./SceneCutsPanel.css";

export function SceneCutsPanel({
   source,
   document,
   onApply,
   onClose,
}: {
   source: MediaSource;
   document: EditDocument;
   onApply: (document: EditDocument) => void;
   onClose: () => void;
}) {
   const [threshold, setThreshold] = useState("10");
   const [scan, setScan] = useState<{ sourceId: string; threshold: string; cuts: number[] | null; error: string | null } | null>(null);
   const [excluded, setExcluded] = useState<Set<number>>(new Set());
   useEffect(() => {
      let active = true;
      const requestId = crypto.randomUUID();
      void window.desktop.autoDetectCuts({ sourceId: source.id, requestId, threshold: Number(threshold) }).then(
         (cuts) => {
            if (active) setScan({ sourceId: source.id, threshold, cuts, error: null });
         },
         (value: unknown) => {
            if (active) setScan({ sourceId: source.id, threshold, cuts: null, error: errorText(value) });
         }
      );
      return () => {
         active = false;
         void window.desktop.cancelScenes(requestId).catch(() => {});
      };
   }, [source.id, threshold]);
   const busy = !scan || scan.sourceId !== source.id || scan.threshold !== threshold;
   const error = busy ? null : scan.error;
   const cuts = useMemo(() => {
      if (!scan || scan.sourceId !== source.id || scan.threshold !== threshold) return null;
      return scan.cuts?.filter((time) => document.clips.some((clip) => time > clip.start + 0.001 && time < clip.end - 0.001)) ?? null;
   }, [scan, source.id, threshold, document.clips]);
   const result = useMemo(() => {
      try {
         return {
            document: splitAtSceneCuts(
               document,
               (cuts ?? []).filter((time) => !excluded.has(time))
            ),
            error: null,
         };
      } catch (value) {
         return { document, error: errorText(value) };
      }
   }, [document, cuts, excluded]);
   const count = result.document.clips.length - document.clips.length;
   return (
      <Modal title="Auto detect cuts" onClose={onClose} className="scene-cuts-modal">
         <div className="modal-body scene-cuts-body">
            <div className="scene-cuts-sensitivity">
               <span className="field-label">Sensitivity</span>
               <SegmentedControl
                  label="Scene cut sensitivity"
                  value={threshold}
                  onChange={(value) => {
                     setThreshold(value);
                     setScan(null);
                     setExcluded(new Set());
                  }}
                  options={[
                     { value: "18", label: "Low" },
                     { value: "10", label: "Normal" },
                     { value: "5", label: "High" },
                  ]}
               />
            </div>
            <section className="scene-cuts-results" aria-label="Scene scan results" aria-busy={busy}>
               <div className="scene-cuts-summary">
                  <h3>Scene cuts</h3>
                  <span role="status">{cuts ? `${cuts.length} found` : ""}</span>
               </div>
               <div className="scene-cuts-content">
                  {busy ? (
                     <div className="scene-cuts-empty" role="status">
                        <span>Scanning video...</span>
                        <progress aria-label="Scanning video" />
                     </div>
                  ) : error ? (
                     <div className="scene-cuts-empty" role="alert">
                        <span>{error}</span>
                     </div>
                  ) : cuts?.length ? (
                     <div className="scene-cuts-list" role="group" aria-label="Detected scene cuts">
                        {cuts.map((time) => (
                           <label key={time} className={excluded.has(time) ? "excluded" : ""}>
                              <span>{formatTime(time, 3)}</span>
                              <input
                                 type="checkbox"
                                 checked={!excluded.has(time)}
                                 onChange={(event) => {
                                    const checked = event.target.checked;
                                    setExcluded((current) => {
                                       const next = new Set(current);
                                       if (checked) next.delete(time);
                                       else next.add(time);
                                       return next;
                                    });
                                 }}
                              />
                           </label>
                        ))}
                     </div>
                  ) : (
                     <div className="scene-cuts-empty">
                        <span>No cuts found.</span>
                     </div>
                  )}
               </div>
            </section>
            {result.error && (
               <p className="scene-cuts-note error" role="alert">
                  {result.error}
               </p>
            )}
         </div>
         <div className="modal-footer scene-cuts-footer">
            <span className="scene-cuts-selection" role="status">
               {cuts ? `${cuts.length - excluded.size} selected` : ""}
            </span>
            <Button
               variant="primary"
               icon={faScissors}
               disabled={busy || count === 0 || !!result.error}
               onClick={() => {
                  onApply(result.document);
                  onClose();
               }}
            >
               Split clips
            </Button>
         </div>
      </Modal>
   );
}
