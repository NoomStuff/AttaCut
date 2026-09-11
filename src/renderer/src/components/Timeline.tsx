import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { EditDocument } from "../editor/model";
import type { Clip } from "../../../shared/types";
import { clipChanges } from "../editor/clipChanges";
import { clipColor } from "../editor/colors";
import { minClipLength, trimClip } from "../editor/model";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { clamp, formatTime } from "../../../shared/time";
import { snapBoundary, adjacentKeyframe } from "../editor/navigation";
import { IconButton } from "./Controls";
import { pointerSmoothingMs, useSmoothValue } from "../lib/motion";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";

function zoomLength(length: number, duration: number, direction: number): number {
   if (direction === 0) return duration;
   const percent = (100 * duration) / length;
   const levels = Array.from({ length: 10 }, (_, decade) => [100, 125, 150, 200, 250, 300, 400, 500, 600, 800].map((step) => step * 10 ** decade)).flat();
   const next = direction > 0 ? levels.find((level) => level > percent + 0.001) : levels.findLast((level) => level < percent - 0.001);
   return clamp((100 * duration) / (next ?? (direction > 0 ? levels.at(-1)! : 100)), Math.min(0.5, duration), duration);
}

// Stationary ruler ladder: tick times come from this scale, so their meaning survives zooming
// and panning. Finer steps fade in between as space allows. Each major has a minor that
// subdivides it using only ladder values.
const RULER_STEPS = Array.from({ length: 25 }, (_, index) => 0.125 * 2 ** index);
function minorStepFor(step: number): number {
   return step / 2;
}

interface TimelineProps {
   document: EditDocument;
   duration: number;
   frameStep: number;
   clock: PlaybackClock;
   fitToken: number;
   zoomRequest: { id: number; direction: number };
   keyframes: number[];
   snapping: boolean;
   onSelect: (id: string) => void;
   onCommit: (document: EditDocument) => void;
   onSeek: (time: number) => void;
   onZoom: (percent: number) => void;
   onTrimming: (active: boolean) => void;
}
interface Drag {
   pointerId: number;
   original: EditDocument;
   id: string;
   side: "start" | "end";
   target: HTMLElement;
}
export function Timeline({
   document,
   duration,
   frameStep,
   clock,
   fitToken,
   zoomRequest,
   keyframes,
   snapping,
   onSelect,
   onCommit,
   onSeek,
   onZoom,
   onTrimming,
}: TimelineProps) {
   const time = useClock(clock);
   const viewport = useRef<HTMLDivElement>(null);
   const [view, setView] = useState({ start: 0, length: duration });
   const [draft, setDraft] = useState<EditDocument | null>(null);
   const [presence, setPresence] = useState({
      clips: document.clips,
      entering: [] as string[],
      exiting: [] as { clip: Clip; index: number }[],
      flashes: new Map<string, ("start" | "end")[]>(),
      seams: [] as { time: number; color: number }[],
   });
   if (presence.clips !== document.clips) {
      const kept = new Set(document.clips.map((clip) => clip.id));
      const changes = clipChanges(presence.clips, document.clips);
      setPresence({
         ...changes,
         clips: document.clips,
         exiting: [...presence.exiting.filter(({ clip }) => !kept.has(clip.id)), ...changes.exiting],
      });
   }
   const [hoveredEdge, setHoveredEdge] = useState<{ id: string; side: "start" | "end" } | null>(null);
   const draftRef = useRef<EditDocument | null>(null);
   const drag = useRef<Drag | null>(null);
   const scrubbing = useRef<number | null>(null);
   const [panActive, setPanActive] = useState(false);
   const panning = useRef<{ pointerId: number; x: number; start: number; length: number } | null>(null);
   const pressScrub = useRef<number | null>(null);
   const latest = useRef({ view, duration });
   const latestDrawn = useRef({ start: 0, length: duration });
   const [viewportWidth, setViewportWidth] = useState(0);
   const [chipWidth, setChipWidth] = useState(0);
   // The drawn view and playhead chase their targets so zooms, pans, and seeks read as one
   // continuous motion. Pointer-driven edits (scrub, handle drag) use a short chase instead of
   // exact snapping, and middle-button panning stays 1:1.
   const drawnStart = useSmoothValue(view.start, { duration: 240, snap: () => panning.current !== null });
   const drawnLength = useSmoothValue(view.length, { duration: 240, snap: () => panning.current !== null });
   const drawn = { start: drawnStart, length: drawnLength };
   latestDrawn.current = drawn;
   const visible = draft ?? document;
   const dragging = drag.current;
   const pointerDriven = scrubbing.current !== null || dragging !== null;
   const dragBoundary = dragging ? visible.clips.find((clip) => clip.id === dragging.id)![dragging.side] : time;
   // Share one follower so the dragged edge and playhead cannot drift apart.
   const drawTime = useSmoothValue(dragBoundary, {
      ...(pointerDriven ? { follow: pointerSmoothingMs } : { duration: 170, jump: 0.24 }),
      key: dragging ? "drag:" + dragging.id + ":" + dragging.side : (scrubbing.current ?? "idle"),
   });
   const drawEdge = drawTime;
   useEffect(() => {
      const element = viewport.current!;
      const measure = () => {
         setViewportWidth(element.clientWidth);
         const chip = element.querySelector<HTMLElement>(".timeline-time");
         if (chip) setChipWidth(chip.offsetWidth);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
   }, []);
   const visibleKeys = useMemo(() => {
      // Dense intraframe recordings can have hundreds of thousands of keyframes.
      // Keep every point for snapping, but draw at most 500 distinct ticks.
      let last = -Infinity;
      return keyframes.filter((point) => {
         if (point < drawn.start || point > drawn.start + drawn.length || point - last < drawn.length / 500) return false;
         last = point;
         return true;
      });
   }, [keyframes, drawn.start, drawn.length]);
   latest.current = { view, duration };
   useEffect(() => onZoom((100 * duration) / view.length), [duration, view.length, onZoom]);
   useEffect(() => {
      setView({ start: 0, length: duration });
   }, [duration, fitToken]);
   useEffect(() => {
      setView((current) => {
         const length = zoomLength(current.length, duration, zoomRequest.direction);
         // Zoom around the playhead when it is on screen; otherwise hold the view steady.
         const playhead = clock.get();
         const focus = playhead >= current.start && playhead <= current.start + current.length ? playhead : current.start + current.length / 2;
         const fraction = (focus - current.start) / current.length;
         return { length, start: clamp(focus - fraction * length, 0, duration - length) };
      });
   }, [zoomRequest, duration, clock]);
   useEffect(() => {
      const element = viewport.current!;
      const wheel = (event: WheelEvent) => {
         event.preventDefault();
         const { view: current, duration: total } = latest.current;
         if (event.altKey || event.shiftKey)
            setView({
               ...current,
               start: clamp(current.start + ((event.deltaY + event.deltaX) * current.length) / 900, 0, total - current.length),
            });
         else {
            const rect = element.getBoundingClientRect();
            const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            if (event.deltaY === 0) return;
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
            const length = clamp(current.length * Math.exp(delta * 0.0014), Math.min(0.5, total), total);
            setView({ length, start: clamp(current.start + fraction * (current.length - length), 0, total - length) });
         }
      };
      element.addEventListener("wheel", wheel, { passive: false });
      return () => element.removeEventListener("wheel", wheel);
   }, []);
   const cancel = () => {
      const current = drag.current;
      drag.current = null;
      draftRef.current = null;
      setDraft(null);
      if (current) onTrimming(false);
      if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
   };
   useEffect(() => {
      const escape = (event: KeyboardEvent) => {
         if (event.key === "Escape") cancel();
      };
      window.addEventListener("keydown", escape);
      return () => window.removeEventListener("keydown", escape);
   }, []);
   const pointAt = (clientX: number) => {
      const rect = viewport.current!.getBoundingClientRect();
      // Map against the drawn view so picks land where the eye sees them, even mid-tween.
      return clamp(latestDrawn.current.start + ((clientX - rect.left) / rect.width) * latestDrawn.current.length, 0, duration);
   };
   const x = (point: number) => `${((point - drawn.start) / drawn.length) * 100}%`;
   /** Keep handles usable at this zoom without expanding already shorter clips. */
   const enforceMinLength = (id: string, side: "start" | "end", value: number, source: EditDocument) => {
      const clip = source.clips.find((item) => item.id === id);
      if (!clip) return value;
      const floor = Math.min(clip.end - clip.start, minClipLength(drawn.length, frameStep));
      return side === "start" ? Math.min(value, clip.end - floor) : Math.max(value, clip.start + floor);
   };
   const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string, side: "start" | "end") => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      drag.current = { pointerId: event.pointerId, original: document, id, side, target: event.currentTarget };
      event.currentTarget.setPointerCapture(event.pointerId);
      // Report before seeking: the drag pins the playhead onto the boundary being edited.
      onTrimming(true);
      onSelect(id);
      const clip = document.clips.find((item) => item.id === id)!;
      onSeek(clip[side]);
   };
   const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      let value = pointAt(event.clientX);
      if (snapping) value = snapBoundary(current.original, current.id, current.side, value, keyframes, duration);
      value = enforceMinLength(current.id, current.side, value, current.original);
      const next = trimClip(current.original, current.id, current.side, value, duration);
      draftRef.current = next;
      setDraft(next);
      onSeek(next.clips.find((clip) => clip.id === current.id)![current.side]);
   };
   const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      const next = draftRef.current;
      drag.current = null;
      draftRef.current = null;
      setDraft(null);
      onTrimming(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (next) onCommit(next);
   };
   // Stationary ruler ticks: fixed times from the ladder, so labels keep their meaning while
   // zooming; the next-finer step fades in between as spacing allows.
   const pxPerSecond = viewportWidth > 0 && drawn.length > 0 ? viewportWidth / drawn.length : 0;
   const rulerStep = RULER_STEPS.find((step) => step * pxPerSecond >= 100) ?? RULER_STEPS.at(-1)!;
   const minorStep = minorStepFor(rulerStep);
   const minorSpacing = minorStep * pxPerSecond;
   const minorOpacity = clamp((minorSpacing - 50) / 50, 0, 1);
   const rulerMarks = (() => {
      if (pxPerSecond <= 0) return { major: [], minor: [] as number[] };
      const first = Math.ceil((drawn.start - 0.0001) / rulerStep) * rulerStep;
      const major: number[] = [];
      for (let point = first; point <= drawn.start + drawn.length; point += rulerStep) major.push(+point.toFixed(6));
      const minor: number[] = [];
      if (minorOpacity > 0) {
         const minorFirst = Math.ceil((drawn.start - 0.0001) / minorStep) * minorStep;
         for (let point = minorFirst; point <= drawn.start + drawn.length; point += minorStep) {
            if (Math.abs(point / rulerStep - Math.round(point / rulerStep)) > 0.001) minor.push(+point.toFixed(6));
         }
      }
      return { major, minor };
   })();
   const tickAlign = (point: number) => {
      const percent = ((point - drawn.start) / drawn.length) * 100;
      return percent < 2 ? " edge-start" : percent > 98 ? " edge-end" : "";
   };
   // Labels near the centered time chip would be occluded by it, so they yield to the chip.
   const chipHalf = chipWidth / 2 + 10;
   const underChip = (point: number) => Math.abs(point - (drawn.start + drawn.length / 2)) * pxPerSecond < chipHalf;
   return (
      <section className="timeline-section" aria-label="Clip timeline">
         <div
            className={`timeline-viewport${panActive ? " panning" : ""}`}
            ref={viewport}
            onPointerMove={(event) => {
               const pan = panning.current;
               if (pan?.pointerId === event.pointerId) {
                  const width = event.currentTarget.getBoundingClientRect().width;
                  setView({
                     length: pan.length,
                     start: clamp(pan.start - ((event.clientX - pan.x) * pan.length) / width, 0, duration - pan.length),
                  });
                  return;
               }
               if (pressScrub.current === event.pointerId) {
                  // Movement after pressing turns the click into a scrub; hand over control.
                  pressScrub.current = null;
                  scrubbing.current = event.pointerId;
               }
               if (scrubbing.current === event.pointerId) onSeek(pointAt(event.clientX));
            }}
            onPointerDown={(event) => {
               if (event.button === 1) {
                  setPanActive(true);
                  event.preventDefault();
                  panning.current = { pointerId: event.pointerId, x: event.clientX, start: drawn.start, length: drawn.length };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  return;
               }
               if (event.button !== 0) return;
               event.preventDefault();
               pressScrub.current = event.pointerId;
               event.currentTarget.setPointerCapture(event.pointerId);
               onSeek(pointAt(event.clientX));
            }}
            onPointerUp={(event) => {
               setPanActive(false);
               panning.current = null;
               scrubbing.current = null;
               pressScrub.current = null;
               if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
               setPanActive(false);
               panning.current = null;
               scrubbing.current = null;
               pressScrub.current = null;
            }}
            onLostPointerCapture={() => {
               setPanActive(false);
               panning.current = null;
               scrubbing.current = null;
               pressScrub.current = null;
            }}
            onAuxClick={(event) => {
               if (event.button === 1) event.preventDefault();
            }}
         >
            <div className="timeline-ruler" aria-hidden="true">
               {rulerMarks.major.map((point) => (
                  <span key={point} className={`ruler-tick major${tickAlign(point)}`} style={{ left: x(point) }}>
                     {!underChip(point) && <em>{formatTime(point, rulerStep < 1 ? 2 : 0)}</em>}
                  </span>
               ))}
               {rulerMarks.minor.map((point) => (
                  <span key={point} className={`ruler-tick major${tickAlign(point)}`} style={{ left: x(point), opacity: minorOpacity }}>
                     {!underChip(point) && <em>{formatTime(point, minorStep < 1 ? 2 : 0)}</em>}
                  </span>
               ))}
            </div>
            <div className="timeline-track">
               <div className="excluded-track" />
               {presence.seams.map((seam) => (
                  <span
                     key={seam.time}
                     className="merging-seam"
                     aria-hidden="true"
                     style={{ left: x(seam.time), "--clip-color": clipColor(seam.color) } as CSSProperties}
                     onAnimationEnd={() => setPresence((current) => ({ ...current, seams: current.seams.filter((item) => item !== seam) }))}
                  />
               ))}
               {presence.exiting.map(({ clip, index }) => (
                  <div
                     key={clip.id}
                     className="clip-range selected leaving"
                     aria-hidden="true"
                     style={
                        {
                           left: x(clip.start),
                           width: `${((clip.end - clip.start) / drawn.length) * 100}%`,
                           "--clip-color": clipColor(clip.color),
                        } as CSSProperties
                     }
                     onAnimationEnd={(event) => {
                        if (event.animationName === "clip-leave")
                           setPresence((current) => ({ ...current, exiting: current.exiting.filter((item) => item.clip.id !== clip.id) }));
                     }}
                  >
                     <span className="clip-number">{String(index + 1).padStart(2, "0")}</span>
                     <span className="trim-handle start" />
                     <span className="trim-handle end" />
                  </div>
               ))}
               {visible.clips.map((clip, index) => {
                  // While one of its handles is dragged, render the chasing boundary so the
                  // clip glides with the pointer; everything else stays exact.
                  const draggingHere = dragging?.id === clip.id;
                  const start = draggingHere && dragging!.side === "start" ? drawEdge : clip.start;
                  const end = draggingHere && dragging!.side === "end" ? drawEdge : clip.end;
                  return (
                     <div
                        key={clip.id}
                        className={`clip-range ${clip.id === visible.selectedId ? "selected" : ""}${presence.flashes.has(clip.id) ? " flash" : presence.entering.includes(clip.id) ? " entering" : ""}`}
                        onAnimationEnd={(event) => {
                           if (event.target !== event.currentTarget) return;
                           setPresence((current) => {
                              const flashes = new Map(current.flashes);
                              flashes.delete(clip.id);
                              return { ...current, flashes, entering: current.entering.filter((id) => id !== clip.id) };
                           });
                        }}
                        onPointerMove={(event) => {
                           if (drag.current) return;
                           const rect = event.currentTarget.getBoundingClientRect();
                           const side = event.clientX < rect.left + rect.width / 2 ? "start" : "end";
                           if (hoveredEdge?.id !== clip.id || hoveredEdge.side !== side) setHoveredEdge({ id: clip.id, side });
                        }}
                        onPointerLeave={() => setHoveredEdge(null)}
                        style={
                           {
                              left: x(start),
                              width: `${((end - start) / drawn.length) * 100}%`,
                              "--clip-color": clipColor(clip.color),
                           } as CSSProperties
                        }
                        onPointerDown={(event) => {
                           if (event.button !== 0) return;
                           onSelect(clip.id);
                           // Seek into the clicked clip, matching a click on bare timeline.
                           onSeek(clamp(pointAt(event.clientX), clip.start, clip.end));
                        }}
                     >
                        <span className="clip-number" aria-hidden="true">
                           {String(index + 1).padStart(2, "0")}
                        </span>
                        {snapping &&
                           visibleKeys
                              .filter((point) => point > clip.start && point < clip.end)
                              .map((point) => (
                                 <i key={point} className="keyframe-tick" style={{ left: `${((point - clip.start) / (clip.end - clip.start)) * 100}%` }} />
                              ))}
                        {(["start", "end"] as const).map((side) => (
                           <button
                              key={side}
                              className={`trim-handle ${side}${draggingHere && dragging?.side === side ? " dragging" : ""}${hoveredEdge?.id === clip.id && hoveredEdge.side === side ? " nearby" : ""}${presence.flashes.get(clip.id)?.includes(side) ? " split-edge" : ""}`}
                              role="slider"
                              aria-label={`Clip ${index + 1} ${side}`}
                              aria-valuemin={0}
                              aria-valuemax={duration}
                              aria-valuenow={clip[side]}
                              aria-valuetext={formatTime(clip[side])}
                              onPointerDown={(event) => startDrag(event, clip.id, side)}
                              onPointerMove={moveDrag}
                              onPointerUp={endDrag}
                              onPointerCancel={cancel}
                              onLostPointerCapture={() => {
                                 if (drag.current) cancel();
                              }}
                              onKeyDown={(event) => {
                                 if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.altKey && !event.ctrlKey && !event.metaKey) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                                    const target = snapping
                                       ? adjacentKeyframe(clip[side], direction, keyframes, duration)
                                       : clip[side] + direction * (event.shiftKey ? 1 : frameStep);
                                    const next = trimClip(document, clip.id, side, enforceMinLength(clip.id, side, target, document), duration);
                                    onCommit(next);
                                    onSeek(next.clips.find((item) => item.id === clip.id)![side]);
                                 }
                              }}
                           >
                              <span />
                           </button>
                        ))}
                     </div>
                  );
               })}
            </div>
            {drawTime >= drawn.start && drawTime <= drawn.start + drawn.length && (
               <div className="playhead" style={{ left: x(drawTime) }}>
                  <span />
                  <i />
               </div>
            )}
            {dragging &&
               (() => {
                  // Live length of the clip being trimmed, floating at the moving boundary.
                  const dragged = visible.clips.find((clip) => clip.id === dragging.id);
                  if (!dragged) return null;
                  const percent = clamp(((drawEdge - drawn.start) / drawn.length) * 100, 4, 96);
                  return (
                     <div className="drag-duration" style={{ left: `${percent}%` }}>
                        {formatTime(dragged.end - dragged.start)}
                     </div>
                  );
               })()}
            <div className="timeline-time" aria-label="Playback time">
               <time>{formatTime(time)}</time>
               <span>/</span>
               <time>{formatTime(duration)}</time>
            </div>
            <div className="timeline-edge left" style={{ width: 44 * clamp(drawn.start / (drawn.length * 0.04), 0, 1) }} />
            <div className="timeline-edge right" style={{ width: 44 * clamp((duration - drawn.start - drawn.length) / (drawn.length * 0.04), 0, 1) }} />
         </div>
         <div className="timeline-pan-arrow left" style={{ opacity: drawn.start > 0.001 ? 1 : 0 }}>
            <IconButton
               icon={faChevronLeft}
               label="Pan timeline left"
               disabled={view.start <= 0}
               onClick={() => setView((current) => ({ ...current, start: Math.max(0, current.start - current.length * 0.25) }))}
            />
         </div>
         <div className="timeline-pan-arrow right" style={{ opacity: drawn.start + drawn.length < duration - 0.001 ? 1 : 0 }}>
            <IconButton
               icon={faChevronRight}
               label="Pan timeline right"
               disabled={view.start + view.length >= duration - 0.001}
               onClick={() => setView((current) => ({ ...current, start: Math.min(duration - current.length, current.start + current.length * 0.25) }))}
            />
         </div>
      </section>
   );
}
