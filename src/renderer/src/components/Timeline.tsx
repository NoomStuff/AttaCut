import { visibleKeyframes, zoomLength } from "../editor/timelineView";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { EditDocument } from "../editor/model";
import type { Clip } from "../../../shared/types";
import { clipChanges } from "../editor/clipChanges";
import { clipColor } from "../editor/colors";
import { trimClip } from "../editor/model";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { clamp, formatTime } from "../../../shared/time";
import { resolveBoundary, stepBoundary } from "../editor/navigation";
import { IconButton } from "./Controls";
import { pointerSmoothingMs, useSmoothValue } from "../lib/motion";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";

// Stationary ruler ladder: tick times come from this scale, so their meaning survives zooming
// and panning. Finer steps fade in between as space allows. Each major has a minor that
// subdivides it using only ladder values.
const RULER_STEPS = Array.from({ length: 25 }, (_, index) => 0.125 * 2 ** index);

interface TimelineProps {
   document: EditDocument;
   duration: number;
   frameStep: number;
   clock: PlaybackClock;
   fitToken: number;
   zoomRequest: { id: number; direction: number };
   keyframes: number[];
   snapping: boolean;
   playing: boolean;
   onSelect: (id: string) => void;
   onCommit: (document: EditDocument) => void;
   onSeek: (time: number, preservePriority?: boolean) => void;
   onZoom: (percent: number, viewportWidth: number) => void;
   onTrimming: (active: boolean) => void;
}
interface Drag {
   pointerId: number;
   lastClientX: number;
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
   playing,
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
   const prevSnapping = useRef(snapping);
   const [pop, setPop] = useState<{ time: number; token: number } | null>(null);
   const [tickExit, setTickExit] = useState(false);
   if (prevSnapping.current !== snapping) {
      prevSnapping.current = snapping;
      // Enabling snapping pops the ticks outward from the playhead; disabling fades them
      // out before they unmount.
      if (snapping) setPop((current) => ({ time, token: (current?.token ?? 0) + 1 }));
      else setTickExit(true);
   }
   useEffect(() => {
      // The entry wave is transient: ticks drop their pop class once the slowest landed.
      if (!pop) return;
      const timer = window.setTimeout(() => setPop(null), 800);
      return () => window.clearTimeout(timer);
   }, [pop]);
   useEffect(() => {
      if (!tickExit) return;
      const timer = window.setTimeout(() => setTickExit(false), 180);
      return () => window.clearTimeout(timer);
   }, [tickExit]);
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
   // Share one follower so the dragged edge and playhead cannot drift apart. While playback
   // runs, the drawn time snaps straight to the clock: the picture jumps on a seek, and a
   // gliding playhead would land after the content it points at. Below the jump threshold a
   // retarget snaps instead of tweening, so frame stepping stays 1:1 — unless the seek asked
   // to glide (discrete navigation such as keyframe and clip jumps), which tweens regardless.
   const drawTime = useSmoothValue(dragBoundary, {
      ...(pointerDriven ? { follow: pointerSmoothingMs } : { duration: 170, jump: Math.max(frameStep * 1.5, 0.05), glide: () => clock.consumeGlide() }),
      snap: () => playing,
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
   const pxPerSecond = viewportWidth > 0 && drawn.length > 0 ? viewportWidth / drawn.length : 0;
   const keyframeView = useMemo(() => visibleKeyframes(keyframes, drawn.start, drawn.length, pxPerSecond), [keyframes, drawn.start, drawn.length, pxPerSecond]);
   latest.current = { view, duration };
   useEffect(() => onZoom((100 * duration) / view.length, viewportWidth), [duration, view.length, viewportWidth, onZoom]);
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
   // Keep the playhead inside the center 80% of a zoomed-in view: when it overflows, page
   // the view so it lands exactly on the crossed edge (10% after a left overflow, 90% after
   // a right one), clamped to the timeline ends. Only playhead movement corrects the view,
   // so zooming and panning never shift it; pointer-driven motion (scrub, handle drag) stays
   // 1:1 until it ends. The correction rides the smooth view chase, like the pan buttons.
   const lastPanTime = useRef(-1);
   useEffect(() => {
      if (pointerDriven || time === lastPanTime.current) return;
      lastPanTime.current = time;
      if (view.length >= duration - 0.0001) return;
      const margin = view.length * 0.1;
      let start: number | null = null;
      if (time < view.start + margin) start = time - margin;
      else if (time > view.start + view.length - margin) start = time - view.length + margin;
      if (start === null) return;
      start = clamp(start, 0, duration - view.length);
      if (Math.abs(start - view.start) < 0.0001) return;
      setView({ start, length: view.length });
   }, [time, view, duration, pointerDriven]);
   useEffect(() => {
      const element = viewport.current!;
      const wheel = (event: WheelEvent) => {
         event.preventDefault();
         const { view: current, duration: total } = latest.current;
         if (event.altKey || event.shiftKey) {
            setView({
               ...current,
               start: clamp(current.start + ((event.deltaY + event.deltaX) * current.length) / 900, 0, total - current.length),
            });
         } else {
            const rect = element.getBoundingClientRect();
            const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            if (event.deltaY === 0) return;
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
            // Trackpads emit many small pixel deltas; the coefficient keeps a two-finger
            // gesture responsive while a mouse notch stays around a third of the view.
            const length = clamp(current.length * Math.exp(delta * 0.003), Math.min(0.5, total), total);
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
   const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string, side: "start" | "end") => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      if (globalThis.document.activeElement instanceof HTMLElement) globalThis.document.activeElement.blur();
      drag.current = { pointerId: event.pointerId, lastClientX: event.clientX, original: document, id, side, target: event.currentTarget };
      event.currentTarget.setPointerCapture(event.pointerId);
      // Report before seeking: the drag pins the playhead onto the boundary being edited.
      onTrimming(true);
      onSelect(id);
      const clip = document.clips.find((item) => item.id === id)!;
      onSeek(clip[side]);
   };
   const applyDrag = (clientX: number) => {
      const current = drag.current;
      if (!current) return;
      current.lastClientX = clientX;
      const time = resolveBoundary(current.original, current.id, current.side, pointAt(clientX), {
         duration,
         viewLength: drawn.length,
         frameStep,
         snapping,
         keyframes,
      });
      const next = trimClip(current.original, current.id, current.side, time, duration);
      draftRef.current = next;
      setDraft(next);
      onSeek(next.clips.find((clip) => clip.id === current.id)![current.side]);
   };
   const applyPan = (clientX: number) => {
      const active = panning.current;
      if (!active) return;
      const width = viewportWidth || viewport.current!.getBoundingClientRect().width;
      setView({
         length: active.length,
         start: clamp(active.start - ((clientX - active.x) * active.length) / width, 0, duration - active.length),
      });
   };
   const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      applyDrag(event.clientX);
   };
   const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      const current = drag.current;
      // Apply the release point if decoding skipped the final move event.
      if (event.clientX !== current.lastClientX) applyDrag(event.clientX);
      const next = draftRef.current;
      drag.current = null;
      draftRef.current = null;
      setDraft(null);
      onTrimming(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (next) onCommit(next);
      else onSeek(current.original.clips.find((clip) => clip.id === current.id)![current.side], true);
   };
   const rulerStep = RULER_STEPS.find((step) => step * pxPerSecond >= 100) ?? RULER_STEPS.at(-1)!;
   const minorStep = rulerStep / 2;
   const minorSpacing = minorStep * pxPerSecond;
   const minorOpacity = clamp((minorSpacing - 50) / 50, 0, 1);
   // Labels near the centered time chip would be occluded by it, so they yield to the chip.
   const chipHalf = chipWidth / 2 + 10;
   const underChip = (point: number) => Math.abs(point - (drawn.start + drawn.length / 2)) * pxPerSecond < chipHalf;
   const tickAlign = (point: number) => {
      const percent = ((point - drawn.start) / drawn.length) * 100;
      return percent < 2 ? " edge-start" : percent > 98 ? " edge-end" : "";
   };
   // The ruler and clip track are memoized subtrees: during playback only the playhead and
   // time chip re-render each frame, and a drag re-renders the track through the drawEdge dep.
   const ruler = useMemo(
      () => {
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
         return (
            <div className="timeline-ruler" aria-hidden="true">
               {rulerMarks.major.map((point) => (
                  <span key={point} className={`ruler-tick major${tickAlign(point)}`} style={{ left: `${Math.round((point - drawn.start) * pxPerSecond)}px` }}>
                     {!underChip(point) && <em>{formatTime(point, rulerStep < 1 ? 2 : 0)}</em>}
                  </span>
               ))}
               {rulerMarks.minor.map((point) => (
                  <span
                     key={point}
                     className={`ruler-tick minor${tickAlign(point)}`}
                     style={{ left: `${Math.round((point - drawn.start) * pxPerSecond)}px`, opacity: minorOpacity }}
                  >
                     {!underChip(point) && <em>{formatTime(point, minorStep < 1 ? 2 : 0)}</em>}
                  </span>
               ))}
            </div>
         );
      },
      // eslint: the tickAlign/underChip helpers derive from the listed values
      [pxPerSecond, rulerStep, minorStep, minorOpacity, drawn.start, drawn.length, chipHalf]
   );
   const track = useMemo(
      () => (
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
                  >
                     <span className="clip-number" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                     </span>
                     {(snapping || tickExit) &&
                        keyframeView.ticks
                           .filter((point) => point > clip.start && point < clip.end)
                           .map((point) => {
                              // The pop wave travels out from the playhead at toggle time.
                              const delay = pop && pxPerSecond > 0 ? Math.round(Math.min((Math.abs(point - pop.time) * pxPerSecond) / 2400, 0.5) * 1000) : null;
                              return (
                                 <i
                                    key={point}
                                    className={`keyframe-tick${pop ? " pop" : ""}${!snapping && tickExit ? " leaving" : ""}`}
                                    style={
                                       {
                                          left: `${((point - clip.start) / (clip.end - clip.start)) * 100}%`,
                                          opacity: keyframeView.opacity,
                                          "--kf-o": keyframeView.opacity,
                                          ...(delay !== null ? { "--pop-delay": `${delay}ms` } : {}),
                                       } as CSSProperties
                                    }
                                 />
                              );
                           })}
                     {(["start", "end"] as const).map((side) => (
                        <button
                           key={side}
                           className={`trim-handle ${side}${draggingHere && dragging?.side === side ? " dragging" : ""}${hoveredEdge?.id === clip.id && hoveredEdge.side === side ? " nearby" : ""}${presence.flashes.get(clip.id)?.includes(side) ? " split-edge" : ""}`}
                           role="slider"
                           data-adjacent={
                              side === "start"
                                 ? clip.start - (visible.clips[index - 1]?.end ?? -Infinity) <= frameStep
                                 : (visible.clips[index + 1]?.start ?? Infinity) - clip.end <= frameStep
                           }
                           aria-label={`Clip ${index + 1} ${side}`}
                           aria-valuemin={0}
                           aria-valuemax={duration}
                           aria-valuenow={clip[side]}
                           aria-valuetext={formatTime(clip[side])}
                           onPointerDown={(event) => startDrag(event, clip.id, side)}
                           onClick={(event) => {
                              if (event.detail === 0) {
                                 onSelect(clip.id);
                                 onSeek(clip[side], true);
                              }
                           }}
                           onPointerMove={moveDrag}
                           onPointerUp={endDrag}
                           onPointerCancel={cancel}
                           onLostPointerCapture={() => {
                              if (drag.current) cancel();
                           }}
                           data-press-ignore
                           onKeyDown={(event) => {
                              if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.altKey && !event.ctrlKey && !event.metaKey) {
                                 event.preventDefault();
                                 event.stopPropagation();
                                 const direction = event.key === "ArrowLeft" ? -1 : 1;
                                 const target = stepBoundary(document, clip.id, side, direction, {
                                    duration,
                                    viewLength: drawn.length,
                                    frameStep,
                                    snapping,
                                    keyframes,
                                    step: event.shiftKey ? 1 : frameStep,
                                 });
                                 const next = trimClip(document, clip.id, side, target, duration);
                                 onCommit(next);
                                 onSeek(next.clips.find((item) => item.id === clip.id)![side], true);
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
      ),
      // eslint: the handlers inside derive from these values; while dragging, the drawEdge
      // entry re-renders the track each frame so the dragged clip glides with the pointer
      [
         visible,
         presence,
         hoveredEdge,
         snapping,
         keyframeView,
         pop,
         tickExit,
         pxPerSecond,
         drawn.start,
         drawn.length,
         frameStep,
         duration,
         document,
         onSelect,
         onCommit,
         onSeek,
         dragging ? drawEdge : 0,
      ]
   );
   return (
      <section className="timeline-section" aria-label="Clip timeline">
         <div
            className={`timeline-viewport${panActive ? " panning" : ""}`}
            ref={viewport}
            onPointerMove={(event) => {
               const pan = panning.current;
               if (pan?.pointerId === event.pointerId) {
                  applyPan(event.clientX);
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
                  // Anchor the pan to the drawn (visual) frame, but pin the target length:
                  // capturing the smoothed length would freeze a mid-tween zoom level.
                  panning.current = { pointerId: event.pointerId, x: event.clientX, start: drawn.start, length: view.length };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  return;
               }
               if (event.button !== 0) return;
               event.preventDefault();
               if (globalThis.document.activeElement instanceof HTMLElement) globalThis.document.activeElement.blur();
               pressScrub.current = event.pointerId;
               event.currentTarget.setPointerCapture(event.pointerId);
               onSeek(pointAt(event.clientX));
            }}
            onPointerUp={(event) => {
               // Pointer moves can be coalesced while decoding. Honor the release
               // position even when the final move was not delivered.
               if (scrubbing.current === event.pointerId) onSeek(pointAt(event.clientX));
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
            {ruler}
            {track}
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
