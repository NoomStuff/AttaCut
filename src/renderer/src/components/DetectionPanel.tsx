import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MediaSource } from "../../../shared/media";
import { formatTime } from "../../../shared/time";
import { chapterSplitTimes, rangesInClips, removeRanges, splitAtSceneCuts, timeEpsilon, type EditDocument } from "../editor/model";
import { errorText } from "../lib/errors";
import { Button, Modal } from "./Controls";
import { SegmentedControl } from "./SegmentedControl";
import { faEraser, faScissors } from "@fortawesome/free-solid-svg-icons";

import "./DetectionPanel.css";

export type DetectionMode = "scenes" | "silence" | "black" | "chapters";
/** A split point (`end` null) or a range to remove. Items are keyed by their start. */
interface Found {
   start: number;
   end: number | null;
   title: string | null;
}
interface Scan {
   items: Found[] | null;
   error: string | null;
}
type Request =
   | { key: string; mode: "scenes"; threshold: number }
   | { key: string; mode: "silence"; audioIndex: number; noise: number; minimum: number }
   | { key: string; mode: "black"; minimum: number }
   | { key: string; mode: "chapters" };

const sensitivityOptions = [
   { value: "18", label: "Low" },
   { value: "10", label: "Normal" },
   { value: "5", label: "High" },
] as const;
const noiseOptions = [
   { value: "-50", label: "-50 dB" },
   { value: "-40", label: "-40 dB" },
   { value: "-30", label: "-30 dB" },
] as const;
const silenceLengthOptions = [
   { value: "0.5", label: "0.5 s" },
   { value: "1", label: "1 s" },
   { value: "2", label: "2 s" },
] as const;
const blackLengthOptions = [
   { value: "0.1", label: "0.1 s" },
   { value: "0.5", label: "0.5 s" },
   { value: "2", label: "2 s" },
] as const;
const noneSkipped: ReadonlySet<number> = new Set();
const copy = {
   scenes: { heading: "Scene cuts", scanning: "Scanning video...", empty: "No cuts found.", list: "Detected scene cuts" },
   silence: { heading: "Silent parts", scanning: "Scanning audio...", empty: "No silence found.", list: "Detected silent parts" },
   black: { heading: "Black parts", scanning: "Scanning video...", empty: "No black frames found.", list: "Detected black parts" },
   chapters: { heading: "Chapters", scanning: "Reading chapters...", empty: "No chapters inside the clips.", list: "Chapter starts" },
} as const;

function runScan(source: MediaSource, request: Request, requestId: string): Promise<Found[]> {
   switch (request.mode) {
      case "scenes":
         return window.desktop
            .autoDetectCuts({ sourceId: source.id, requestId, threshold: request.threshold })
            .then((cuts) => cuts.map((start) => ({ start, end: null, title: null })));
      case "chapters": {
         const chapters = [...source.chapters].sort((a, b) => a.start - b.start);
         const times = chapterSplitTimes(chapters, source.duration);
         // Chapter marks are free times; split on the source frames nearest to them.
         return window.desktop.frameTimes(source.id, times).then((resolved) => {
            const found: Found[] = [];
            for (const [index, start] of resolved.entries()) {
               if (start <= timeEpsilon || start >= source.duration - timeEpsilon || found.some((item) => item.start === start)) continue;
               const title = chapters.find((chapter) => chapter.start === times[index])?.title.trim();
               found.push({ start, end: null, title: title || null });
            }
            return found;
         });
      }
      case "silence":
      case "black":
         return window.desktop
            .detectRanges({
               sourceId: source.id,
               requestId,
               detection:
                  request.mode === "silence"
                     ? { kind: "silence", audioIndex: request.audioIndex, noise: request.noise, minimum: request.minimum }
                     : { kind: "black", minimum: request.minimum },
            })
            .then((ranges) => ranges.map(({ start, end }) => ({ start, end, title: null })));
   }
}

/** Scene cuts, chapters, silence and black frames share one preview-then-apply flow. */
export function DetectionPanel({
   source,
   document,
   minimum,
   audio,
   onApply,
   onClose,
}: {
   source: MediaSource;
   document: EditDocument;
   /** Shortest clip worth keeping: one source frame. */
   minimum: number;
   /** The audio track silence detection reads, or null when the source has none. */
   audio: { index: number; label: string | null } | null;
   onApply: (document: EditDocument) => void;
   onClose: () => void;
}) {
   const hasChapters = chapterSplitTimes(source.chapters, source.duration).length > 0;
   const [mode, setMode] = useState<DetectionMode>("scenes");
   const [threshold, setThreshold] = useState<(typeof sensitivityOptions)[number]["value"]>("10");
   const [noise, setNoise] = useState<(typeof noiseOptions)[number]["value"]>("-40");
   const [silenceLength, setSilenceLength] = useState<(typeof silenceLengthOptions)[number]["value"]>("1");
   const [blackLength, setBlackLength] = useState<(typeof blackLengthOptions)[number]["value"]>("0.5");
   const [results, setResults] = useState<Record<string, Scan>>({});
   const [excluded, setExcluded] = useState<Record<string, ReadonlySet<number>>>({});
   // A primitive dependency: the parent passes a fresh audio object on every render.
   const audioIndex = audio?.index;
   const request = useMemo((): Request => {
      if (mode === "silence" && audioIndex !== undefined)
         return { key: `silence:${audioIndex}:${noise}:${silenceLength}`, mode, audioIndex, noise: Number(noise), minimum: Number(silenceLength) };
      if (mode === "black") return { key: `black:${blackLength}`, mode, minimum: Number(blackLength) };
      if (mode === "chapters") return { key: "chapters", mode };
      return { key: `scenes:${threshold}`, mode: "scenes", threshold: Number(threshold) };
   }, [mode, audioIndex, noise, silenceLength, blackLength, threshold]);
   const scan = results[request.key];
   const cached = scan !== undefined;
   useEffect(() => {
      if (cached) return;
      let active = true;
      const requestId = crypto.randomUUID();
      const store = (value: Scan) => {
         if (active) setResults((current) => ({ ...current, [request.key]: value }));
      };
      void runScan(source, request, requestId).then(
         (items) => store({ items, error: null }),
         (value: unknown) => store({ items: null, error: errorText(value) })
      );
      return () => {
         active = false;
         if (request.mode !== "chapters") void window.desktop.cancelDetection(requestId).catch(() => {});
      };
   }, [cached, request, source]);
   const busy = !scan;
   const error = scan?.error ?? null;
   const removing = request.mode === "silence" || request.mode === "black";
   const skipped = excluded[request.key] ?? noneSkipped;
   const items = useMemo(() => {
      if (!scan?.items) return null;
      if (removing) return rangesInClips(document.clips, scan.items as (Found & { end: number })[]);
      return scan.items.filter((item) => document.clips.some((clip) => item.start > clip.start + timeEpsilon && item.start < clip.end - timeEpsilon));
   }, [scan, removing, document.clips]);
   const result = useMemo(() => {
      const chosen = (items ?? []).filter((item) => !skipped.has(item.start));
      try {
         if (!removing)
            return {
               document: splitAtSceneCuts(
                  document,
                  chosen.map((item) => item.start)
               ),
               error: null,
            };
         const next = removeRanges(
            document,
            chosen.map((item) => ({ start: item.start, end: item.end ?? item.start })),
            minimum
         );
         return { document: next, error: document.clips.length && !next.clips.length ? "This would remove every clip." : null };
      } catch (value) {
         return { document, error: errorText(value) };
      }
   }, [document, items, skipped, removing, minimum]);
   const changed = result.document !== document;
   const text = copy[request.mode];
   const option = (label: string, control: ReactNode, wide = false) => (
      <div className={`detection-option${wide ? " wide" : ""}`}>
         <span className="field-label">{label}</span>
         {control}
      </div>
   );
   return (
      <Modal title="Auto detect cuts" onClose={onClose} className="detection-modal">
         <div className="modal-body detection-body">
            <SegmentedControl
               label="Detect"
               className="detection-mode"
               value={mode}
               onChange={setMode}
               options={[
                  { value: "scenes", label: "Scene cuts" },
                  { value: "silence", label: "Silence", disabled: !audio, ...(audio ? {} : { title: "This video has no audio." }) },
                  { value: "black", label: "Black frames" },
                  ...(hasChapters ? [{ value: "chapters" as const, label: "Chapters" }] : []),
               ]}
            />
            <div className="detection-options">
               {request.mode === "scenes" &&
                  option(
                     "Sensitivity",
                     <SegmentedControl label="Scene cut sensitivity" value={threshold} onChange={setThreshold} options={sensitivityOptions} />,
                     true
                  )}
               {request.mode === "silence" && (
                  <>
                     {option("Quieter than", <SegmentedControl label="Silence level" value={noise} onChange={setNoise} options={noiseOptions} />)}
                     {option(
                        "Lasting at least",
                        <SegmentedControl label="Shortest silence" value={silenceLength} onChange={setSilenceLength} options={silenceLengthOptions} />
                     )}
                  </>
               )}
               {request.mode === "black" &&
                  option(
                     "Lasting at least",
                     <SegmentedControl label="Shortest black part" value={blackLength} onChange={setBlackLength} options={blackLengthOptions} />,
                     true
                  )}
               {request.mode === "chapters" && option("Split at", <p className="detection-hint">Chapter starts saved in the video</p>, true)}
            </div>
            <section className="detection-results" aria-label="Scan results" aria-busy={busy}>
               <div className="detection-summary">
                  <h3>
                     {text.heading}
                     {request.mode === "silence" && audio?.label && <span className="detection-track"> · {audio.label}</span>}
                  </h3>
                  <span role="status">{items ? `${items.length} found` : ""}</span>
               </div>
               <div className="detection-content">
                  {busy ? (
                     <div className="detection-empty" role="status">
                        <span>{text.scanning}</span>
                        <progress aria-label={text.scanning.replace("...", "")} />
                     </div>
                  ) : error ? (
                     <div className="detection-empty" role="alert">
                        <span>{error}</span>
                     </div>
                  ) : items?.length ? (
                     <div className="detection-list" role="group" aria-label={text.list}>
                        {items.map((item) => (
                           <label key={item.start} className={skipped.has(item.start) ? "excluded" : ""}>
                              <span className="detection-time">
                                 {formatTime(item.start, 3)}
                                 {item.end !== null && <> → {formatTime(item.end, 3)}</>}
                              </span>
                              {item.title !== null ? (
                                 <span className="detection-detail">{item.title}</span>
                              ) : item.end !== null ? (
                                 <span className="detection-detail">{`${Number((item.end - item.start).toFixed(2))} s`}</span>
                              ) : null}
                              <input
                                 type="checkbox"
                                 checked={!skipped.has(item.start)}
                                 onChange={(event) => {
                                    const checked = event.target.checked;
                                    setExcluded((current) => {
                                       const next = new Set(current[request.key]);
                                       if (checked) next.delete(item.start);
                                       else next.add(item.start);
                                       return { ...current, [request.key]: next };
                                    });
                                 }}
                              />
                           </label>
                        ))}
                     </div>
                  ) : (
                     <div className="detection-empty">
                        <span>{text.empty}</span>
                     </div>
                  )}
               </div>
            </section>
            {result.error && (
               <p className="detection-note error" role="alert">
                  {result.error}
               </p>
            )}
         </div>
         <div className="modal-footer detection-footer">
            <span className="detection-selection" role="status">
               {items ? `${items.filter((item) => !skipped.has(item.start)).length} selected` : ""}
            </span>
            <Button
               variant="primary"
               icon={removing ? faEraser : faScissors}
               disabled={busy || !changed || !!result.error}
               onClick={() => {
                  onApply(result.document);
                  onClose();
               }}
            >
               {removing ? "Remove parts" : "Split clips"}
            </Button>
         </div>
      </Modal>
   );
}
