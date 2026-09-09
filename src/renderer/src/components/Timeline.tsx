import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { EditDocument } from "../editor/model";
import { trimClip } from "../editor/model";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { clamp, formatTime } from "../../../shared/time";
import { snapBoundary, adjacentKeyframe } from "../editor/navigation";
import { IconButton } from "./Controls";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";

function zoomLength(length: number, duration: number, direction: number): number {
   if (direction === 0) return duration;
   const percent = (100 * duration) / length;
   const levels = Array.from({ length: 10 }, (_, decade) => [100, 125, 150, 200, 250, 300, 400, 500, 600, 800].map((step) => step * 10 ** decade)).flat();
   const next = direction > 0 ? levels.find((level) => level > percent + 0.001) : levels.findLast((level) => level < percent - 0.001);
   return clamp((100 * duration) / (next ?? (direction > 0 ? levels.at(-1)! : 100)), Math.min(0.5, duration), duration);
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
   const draftRef = useRef<EditDocument | null>(null);
   const drag = useRef<Drag | null>(null);
   const scrubbing = useRef<number | null>(null);
   const [panActive, setPanActive] = useState(false);
   const panning = useRef<{ pointerId: number; x: number; start: number; length: number } | null>(null);
   const latest = useRef({ view, duration });
   const visibleKeys = useMemo(() => {
      // Dense intraframe recordings can have hundreds of thousands of keyframes.
      // Keep every point for snapping, but draw at most 500 distinct ticks.
      let last = -Infinity;
      return keyframes.filter((point) => {
         if (point < view.start || point > view.start + view.length || point - last < view.length / 500) return false;
         last = point;
         return true;
      });
   }, [keyframes, view]);
   latest.current = { view, duration };
   useEffect(() => onZoom((100 * duration) / view.length), [duration, view.length, onZoom]);
   useEffect(() => {
      setView({ start: 0, length: duration });
   }, [duration, fitToken]);
   useEffect(() => {
      setView((current) => {
         const length = zoomLength(current.length, duration, zoomRequest.direction);
         return { length, start: clamp(clock.get() - length / 2, 0, duration - length) };
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
            const length = zoomLength(current.length, total, -Math.sign(event.deltaY));
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
      return clamp(view.start + ((clientX - rect.left) / rect.width) * view.length, 0, duration);
   };
   const x = (point: number) => `${((point - view.start) / view.length) * 100}%`;
   const visible = draft ?? document;
   const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string, side: "start" | "end") => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.focus();
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
      const value = pointAt(event.clientX);
      const next = trimClip(
         current.original,
         current.id,
         current.side,
         snapping ? snapBoundary(current.original, current.id, current.side, value, keyframes, duration) : value,
         duration
      );
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
   const ticks = Array.from({ length: 9 }, (_, index) => view.start + (view.length * index) / 8);
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
               if (scrubbing.current === event.pointerId) onSeek(pointAt(event.clientX));
            }}
            onPointerDown={(event) => {
               if (event.button === 1) {
                  setPanActive(true);
                  event.preventDefault();
                  panning.current = { pointerId: event.pointerId, x: event.clientX, start: view.start, length: view.length };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  return;
               }
               if (event.button !== 0) return;
               event.preventDefault();
               scrubbing.current = event.pointerId;
               event.currentTarget.setPointerCapture(event.pointerId);
               onSeek(pointAt(event.clientX));
            }}
            onPointerUp={(event) => {
               setPanActive(false);
               panning.current = null;
               scrubbing.current = null;
               if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
               setPanActive(false);
               panning.current = null;
               scrubbing.current = null;
            }}
            onLostPointerCapture={() => {
               setPanActive(false);
               panning.current = null;
               scrubbing.current = null;
            }}
            onAuxClick={(event) => {
               if (event.button === 1) event.preventDefault();
            }}
         >
            <div className="timeline-ruler" aria-hidden="true">
               {ticks.map((tick, index) =>
                  index === 4 ? null : (
                     <span key={index} style={{ left: `${index * 12.5}%` }}>
                        {formatTime(tick, view.length < 15 ? 1 : 0)}
                     </span>
                  )
               )}
            </div>
            <div className="timeline-track">
               <div className="excluded-track" />
               {visible.clips.map((clip, index) => (
                  <div
                     key={clip.id}
                     className={`clip-range ${clip.id === visible.selectedId ? "selected" : ""}`}
                     style={
                        {
                           left: x(clip.start),
                           width: `${((clip.end - clip.start) / view.length) * 100}%`,
                           "--clip-color": `var(--clip-${clip.color % 6})`,
                        } as CSSProperties
                     }
                     onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        onSelect(clip.id);
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
                           className={`trim-handle ${side}`}
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
                                 const next = trimClip(
                                    document,
                                    clip.id,
                                    side,
                                    snapping ? snapBoundary(document, clip.id, side, target, keyframes, duration) : target,
                                    duration
                                 );
                                 onCommit(next);
                                 onSeek(next.clips.find((item) => item.id === clip.id)![side]);
                              }
                           }}
                        >
                           <span />
                        </button>
                     ))}
                  </div>
               ))}
            </div>
            {time >= view.start && time <= view.start + view.length && (
               <div className="playhead" style={{ left: x(time) }}>
                  <span />
                  <i />
               </div>
            )}
            <div className="timeline-time" aria-label="Playback time">
               <time>{formatTime(time)}</time>
               <span>/</span>
               <time>{formatTime(duration)}</time>
            </div>
            <div className="timeline-edge left" style={{ opacity: clamp(view.start / (view.length * 0.04), 0, 1) }} />
            <div className="timeline-edge right" style={{ opacity: clamp((duration - view.start - view.length) / (view.length * 0.04), 0, 1) }} />
         </div>
         <div className="timeline-pan-arrow left" style={{ opacity: view.start > 0 ? 1 : 0 }}>
            <IconButton
               icon={faChevronLeft}
               label="Pan timeline left"
               disabled={view.start <= 0}
               onClick={() => setView((current) => ({ ...current, start: Math.max(0, current.start - current.length * 0.25) }))}
            />
         </div>
         <div className="timeline-pan-arrow right" style={{ opacity: view.start + view.length < duration - 0.001 ? 1 : 0 }}>
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
