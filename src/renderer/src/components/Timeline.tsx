import { frameLevelActive, quantizeToFrame, visibleKeyframes, zoomLength } from "../editor/timelineView";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { EditDocument } from "../editor/model";
import type { Clip } from "../../../shared/types";
import { clipChanges } from "../editor/clipChanges";
import { clipColor } from "../editor/colors";
import { trimClip, minClipLength, timeEpsilon } from "../editor/model";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { clamp, formatTime } from "../../../shared/time";
import { resolveBoundary, snapPlayhead, stepBoundary } from "../editor/navigation";
import { IconButton } from "./Controls";
import { pointerSmoothingMs, useSmoothValue } from "../lib/motion";
import type { Waveform } from "../lib/waveform";
import { faCaretLeft, faCaretRight, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

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
   /** Pans (zoom=false) or zooms and pans (zoom=true) so the range sits in view. */
   viewRequest: { id: number; start: number; end: number; zoom: boolean };
   keyframes: number[];
   snapping: boolean;
   playing: boolean;
   /** Audio peaks for the per-clip waveforms; null while hidden or still resolving. */
   waveform: Waveform | null;
   onSelect: (id: string) => void;
   onCommit: (document: EditDocument, group?: string) => void;
   /** `hover` carries the unquantized pointer position so boundary picks can tell which side
       the pointer is on; it is only set by scrubbing. */
   onSeek: (time: number, preservePriority?: boolean, glide?: boolean, side?: "start" | "end", hover?: number) => void;
   /** Reports the in-progress trim so the transport can show live start, end, and duration. */
   onDraft: (document: EditDocument | null) => void;
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
   viewRequest,
   keyframes,
   snapping,
   playing,
   waveform,
   onSelect,
   onCommit,
   onSeek,
   onDraft,
   onZoom,
   onTrimming,
}: TimelineProps) {
   const section = useRef<HTMLElement>(null);
   const keyboardGesture = useRef<string | null>(null);
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
      if (snapping) setPop((current) => ({ time: clock.get(), token: (current?.token ?? 0) + 1 }));
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
   // Feedback that reads as "the clip moved" (the faded playhead, the delta chip) waits for
   // an actual boundary change; grabbing a handle alone shows nothing.
   const [dragMoved, setDragMoved] = useState(false);
   const scrubbing = useRef<number | null>(null);
   const [panActive, setPanActive] = useState(false);
   const panning = useRef<{ pointerId: number; x: number; start: number; length: number } | null>(null);
   const pressScrub = useRef<number | null>(null);
   const latest = useRef({ view, duration });
   const latestDrawn = useRef({ start: 0, length: duration });
   // Set while playback keeps panning the view to hold the playhead at the margin. The drawn
   // view then snaps to its target instead of chasing it: a tween retargeted every frame
   // settles into a permanent lag that lets the playhead drift past the margin line.
   const followPan = useRef(false);
   const [viewportWidth, setViewportWidth] = useState(0);
   const [chipWidth, setChipWidth] = useState(0);
   // The drawn view chases its target so zooms, pans, and seeks read as one continuous
   // motion. Pointer-driven edits (scrub, handle drag) use a short chase instead of exact
   // snapping, and middle-button panning stays 1:1.
   const drawnStart = useSmoothValue(view.start, { duration: 240, snap: () => panning.current !== null || followPan.current });
   const drawnLength = useSmoothValue(view.length, { duration: 240, snap: () => panning.current !== null || followPan.current });
   const drawn = { start: drawnStart, length: drawnLength };
   latestDrawn.current = drawn;
   const visible = draft ?? document;
   const dragging = drag.current;
   // The dragged edge chases the boundary so the clip glides with the pointer. The playhead
   // leaf mirrors this follower, so the edge and the line cannot drift apart.
   const dragDrawTime = useSmoothValue(dragging ? visible.clips.find((clip) => clip.id === dragging.id)![dragging.side] : 0, {
      ...(dragging ? { follow: pointerSmoothingMs } : { duration: 170 }),
      snap: () => playing && !!dragging,
      key: dragging ? "drag:" + dragging.id + ":" + dragging.side : "idle",
   });
   const drawEdge = dragging ? dragDrawTime : 0;
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
   // Frame-level editing: with only a few dozen frames on screen, every pick quantizes to
   // the frame grid so cuts land exactly where the eye points and releases need not snap.
   const frameLevel = frameLevelActive(drawn.length, frameStep);
   const keyframeView = useMemo(() => visibleKeyframes(keyframes, drawn.start, drawn.length, pxPerSecond), [keyframes, drawn.start, drawn.length, pxPerSecond]);
   latest.current = { view, duration };
   useEffect(() => onZoom((100 * duration) / view.length, viewportWidth), [duration, view.length, viewportWidth, onZoom]);
   useEffect(() => {
      setView({ start: 0, length: duration });
   }, [duration, fitToken]);
   useEffect(() => {
      if (!viewRequest.id) return;
      setView((current) => {
         const { start, end } = viewRequest;
         if (!viewRequest.zoom) {
            // Reveal: pan only, and leave the view alone when the range is already on screen.
            if (start >= current.start && end <= current.start + current.length) return current;
            const center = (start + end) / 2;
            return { length: current.length, start: clamp(center - current.length / 2, 0, duration - current.length) };
         }
         // Focus: put the handles at 10% and 90% of the view. The zoom clamp (a half-second
         // floor, like the wheel) and the timeline ends decide how close that can get.
         const length = clamp((end - start) / 0.8, Math.min(0.5, duration), duration);
         return { length, start: clamp(start - length * 0.1, 0, duration - length) };
      });
   }, [viewRequest, duration]);
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
   // 1:1 until it ends. Paused moves count too, so shortcuts and transport jumps keep the
   // playhead in range exactly like playback does. This listens to the clock directly
   // instead of rendering with it, so playback costs no Timeline renders here except when a
   // pan actually fires.
   const lastPanTime = useRef(-1);
   useEffect(() => {
      if (!playing) followPan.current = false;
      return clock.subscribe(() => {
         const current = clock.get();
         if (scrubbing.current !== null || drag.current || current === lastPanTime.current) return;
         lastPanTime.current = current;
         const { view: currentView, duration: total } = latest.current;
         if (currentView.length >= total - 0.0001) {
            followPan.current = false;
            return;
         }
         const margin = currentView.length * 0.1;
         let start: number | null = null;
         if (current < currentView.start + margin) start = current - margin;
         else if (current > currentView.start + currentView.length - margin) start = current - currentView.length + margin;
         if (start === null) {
            followPan.current = false;
            return;
         }
         start = clamp(start, 0, total - currentView.length);
         if (Math.abs(start - currentView.start) < 0.0001) {
            followPan.current = false;
            return;
         }
         // Playback snaps the drawn view to each page so the playhead cannot outrun it.
         // Paused moves tween instead: they are single jumps, and the chase keeps them as
         // smooth as the pan buttons while repeated shortcuts retarget freely.
         followPan.current = playing;
         setView({ start, length: currentView.length });
      });
   }, [clock, playing]);
   useEffect(() => {
      // Listened on the whole section so the gutters and pan arrows flanking the viewport
      // stay part of the pan and zoom gesture area rather than dead zones.
      const sectionElement = section.current!;
      const wheel = (event: WheelEvent) => {
         event.preventDefault();
         const element = viewport.current!;
         const { view: current, duration: total } = latest.current;
         if (event.altKey || event.shiftKey || (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
            setView({
               ...current,
               start: clamp(current.start + ((event.deltaY + event.deltaX) * current.length) / 900, 0, total - current.length),
            });
         } else {
            const rect = element.getBoundingClientRect();
            const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            if (event.deltaY === 0) return;
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
            // Mice deliver one large delta per detent while trackpads and pinch gestures
            // stream many small ones on a device-dependent scale. Detents zoom a fixed step
            // per notch so speed follows the wheel rather than the OS scroll setting; small
            // deltas zoom per pixel with a boost so light gestures stay responsive, capped
            // so a single event can never lurch the view.
            const magnitude = Math.abs(delta);
            const exponent = event.ctrlKey
               ? clamp(delta * 0.01, -0.2, 0.2)
               : magnitude >= 60
                 ? Math.sign(delta) * 0.15 * Math.min(magnitude / 100, 3)
                 : Math.sign(delta) * Math.min(magnitude * 0.008, 0.1);
            const length = clamp(current.length * Math.exp(exponent), Math.min(0.5, total), total);
            setView({ length, start: clamp(current.start + fraction * (current.length - length), 0, total - length) });
         }
      };
      sectionElement.addEventListener("wheel", wheel, { passive: false });
      return () => sectionElement.removeEventListener("wheel", wheel);
   }, []);
   const cancel = useCallback(() => {
      const current = drag.current;
      drag.current = null;
      draftRef.current = null;
      setDraft(null);
      setDragMoved(false);
      onDraft(null);
      if (current) onTrimming(false);
      if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
   }, [onDraft, onTrimming]);
   useEffect(() => {
      const escape = (event: KeyboardEvent) => {
         if (event.key === "Escape") cancel();
      };
      window.addEventListener("keydown", escape);
      return () => window.removeEventListener("keydown", escape);
   }, [cancel]);
   const pointAt = useCallback(
      (clientX: number) => {
         const rect = viewport.current!.getBoundingClientRect();
         // Map against the drawn view so picks land where the eye sees them, even mid-tween.
         return clamp(latestDrawn.current.start + ((clientX - rect.left) / rect.width) * latestDrawn.current.length, 0, duration);
      },
      [duration]
   );
   const scrubTarget = useCallback(
      (clientX: number) => {
         const raw = pointAt(clientX);
         // Up close, the frame grid replaces keyframe snapping: it is strictly finer, and
         // every legal cut sits on it anyway.
         if (frameLevel) return quantizeToFrame(raw, frameStep, 0, duration);
         return snapping ? snapPlayhead(raw, keyframes, duration) : raw;
      },
      [pointAt, frameLevel, frameStep, duration, snapping, keyframes]
   );
   const x = useCallback((point: number) => `${((point - drawn.start) / drawn.length) * 100}%`, [drawn.start, drawn.length]);
   const startDrag = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>, id: string, side: "start" | "end") => {
         if (event.button !== 0) return;
         event.stopPropagation();
         event.preventDefault();
         if (globalThis.document.activeElement instanceof HTMLElement) globalThis.document.activeElement.blur();
         drag.current = { pointerId: event.pointerId, lastClientX: event.clientX, original: document, id, side, target: event.currentTarget };
         event.currentTarget.setPointerCapture(event.pointerId);
         // Report before seeking: the drag pins the playhead onto the boundary being edited.
         setDragMoved(false);
         onTrimming(true);
         onSelect(id);
         const clip = document.clips.find((item) => item.id === id)!;
         onSeek(clip[side], true, false, side);
      },
      [document, onTrimming, onSelect, onSeek]
   );
   const applyDrag = useCallback(
      (clientX: number) => {
         const current = drag.current;
         if (!current) return;
         current.lastClientX = clientX;
         const raw = pointAt(clientX);
         const time = resolveBoundary(current.original, current.id, current.side, frameLevel ? quantizeToFrame(raw, frameStep, 0, duration) : raw, {
            duration,
            frameStep,
            snapping: frameLevel ? false : snapping,
            keyframes,
         });
         const next = trimClip(current.original, current.id, current.side, time, duration);
         const after = next.clips.find((clip) => clip.id === current.id)![current.side];
         if (after !== current.original.clips.find((clip) => clip.id === current.id)![current.side]) setDragMoved(true);
         draftRef.current = next;
         setDraft(next);
         onDraft(next);
         onSeek(after, true, false, current.side);
      },
      [pointAt, frameLevel, frameStep, duration, snapping, keyframes, onDraft, onSeek]
   );
   const applyPan = (clientX: number) => {
      const active = panning.current;
      if (!active) return;
      const width = viewportWidth || viewport.current!.getBoundingClientRect().width;
      setView({
         length: active.length,
         start: clamp(active.start - ((clientX - active.x) * active.length) / width, 0, duration - active.length),
      });
   };
   const moveDrag = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
         const current = drag.current;
         if (!current || current.pointerId !== event.pointerId) return;
         applyDrag(event.clientX);
      },
      [applyDrag]
   );
   const endDrag = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
         if (drag.current?.pointerId !== event.pointerId) return;
         const current = drag.current;
         // Apply the release point if decoding skipped the final move event.
         if (event.clientX !== current.lastClientX) applyDrag(event.clientX);
         const next = draftRef.current;
         drag.current = null;
         draftRef.current = null;
         setDraft(null);
         setDragMoved(false);
         onTrimming(false);
         if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
         if (next) onCommit(next);
         else onSeek(current.original.clips.find((clip) => clip.id === current.id)![current.side], true, false, current.side);
         onDraft(null);
      },
      [applyDrag, onDraft, onTrimming, onCommit, onSeek]
   );
   const rulerStep = RULER_STEPS.find((step) => step * pxPerSecond >= 100) ?? RULER_STEPS.at(-1)!;
   const minorStep = rulerStep / 2;
   const minorSpacing = minorStep * pxPerSecond;
   const minorOpacity = clamp((minorSpacing - 50) / 50, 0, 1);
   // Labels yield to the centered time chip by fading out across its edge instead of
   // vanishing, so panning never pops a label in or out mid-view.
   const chipHalf = chipWidth / 2;
   // Edge fades span 44px and shrink toward nothing as the view approaches that end of the
   // timeline. The ruler's edge alignment keys off the same values: centered labels only
   // need nudging inward where no fade will hide their overhang.
   const fadeScale = drawn.length * 0.04;
   const leftFade = clamp(drawn.start / fadeScale, 0, 1) * 44;
   const rightFade = clamp((duration - drawn.start - drawn.length) / fadeScale, 0, 1) * 44;
   const leftStop = leftFade > 0.5 ? Math.min(leftFade, viewportWidth / 2) : 0;
   const rightStop = rightFade > 0.5 ? Math.min(rightFade, viewportWidth / 2) : 0;
   // The ruler and clip track are memoized subtrees, and the playhead and time chip subscribe
   // to the clock in their own leaf: during playback the Timeline itself never re-renders,
   // and a drag re-renders the track through the drawEdge dep.
   const ruler = useMemo(() => {
      const labelFade = (point: number) => {
         if (chipHalf <= 0) return 1;
         const distance = Math.abs(point - (drawn.start + drawn.length / 2)) * pxPerSecond;
         return clamp((distance - chipHalf) / 14, 0, 1);
      };
      const tickAlign = (point: number) => {
         const percent = ((point - drawn.start) / drawn.length) * 100;
         return leftStop === 0 && percent < 2 ? " edge-start" : rightStop === 0 && percent > 98 ? " edge-end" : "";
      };
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
                  <em style={{ opacity: labelFade(point) }}>{formatTime(point, rulerStep < 1 ? 2 : 0)}</em>
               </span>
            ))}
            {rulerMarks.minor.map((point) => (
               <span
                  key={point}
                  className={`ruler-tick minor${tickAlign(point)}`}
                  style={{ left: `${Math.round((point - drawn.start) * pxPerSecond)}px`, opacity: minorOpacity }}
               >
                  <em style={{ opacity: labelFade(point) }}>{formatTime(point, minorStep < 1 ? 2 : 0)}</em>
               </span>
            ))}
         </div>
      );
   }, [pxPerSecond, rulerStep, minorStep, minorOpacity, drawn.start, drawn.length, chipHalf, leftStop, rightStop]);
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
                     data-compact={(end - start) * pxPerSecond < 40}
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
                           .filter((point) => point > start && point < end)
                           .map((point) => {
                              // The pop wave travels out from the playhead at toggle time.
                              const delay = pop && pxPerSecond > 0 ? Math.round(Math.min((Math.abs(point - pop.time) * pxPerSecond) / 2400, 0.5) * 1000) : null;
                              return (
                                 <i
                                    key={point}
                                    data-time={point}
                                    className={`keyframe-tick${pop ? " pop" : ""}${!snapping && tickExit ? " leaving" : ""}`}
                                    style={
                                       {
                                          left: `${((point - start) / (end - start)) * 100}%`,
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
                           aria-valuemin={side === "start" ? (visible.clips[index - 1]?.end ?? 0) : Math.min(clip.end, clip.start + minClipLength(frameStep))}
                           aria-valuemax={
                              side === "end" ? (visible.clips[index + 1]?.start ?? duration) : Math.max(clip.start, clip.end - minClipLength(frameStep))
                           }
                           aria-valuenow={clip[side]}
                           aria-valuetext={formatTime(clip[side])}
                           onPointerDown={(event) => startDrag(event, clip.id, side)}
                           onClick={(event) => {
                              if (event.detail === 0) {
                                 onSelect(clip.id);
                                 onSeek(clip[side], true, false, side);
                              }
                           }}
                           onPointerMove={moveDrag}
                           onPointerUp={endDrag}
                           onPointerCancel={cancel}
                           onLostPointerCapture={() => {
                              if (drag.current) cancel();
                           }}
                           data-press-ignore
                           onKeyUp={() => {
                              keyboardGesture.current = null;
                           }}
                           onBlur={() => {
                              keyboardGesture.current = null;
                           }}
                           onKeyDown={(event) => {
                              if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.altKey && !event.ctrlKey && !event.metaKey) {
                                 event.preventDefault();
                                 event.stopPropagation();
                                 const direction = event.key === "ArrowLeft" ? -1 : 1;
                                 const target = stepBoundary(document, clip.id, side, direction, {
                                    duration,
                                    frameStep,
                                    snapping: snapping && !frameLevel,
                                    keyframes,
                                    step: event.shiftKey ? 1 : frameStep,
                                 });
                                 const next = trimClip(document, clip.id, side, target, duration);
                                 keyboardGesture.current ??= crypto.randomUUID();
                                 onCommit(next, keyboardGesture.current);
                                 onSeek(next.clips.find((item) => item.id === clip.id)![side], true, false, side);
                              }
                           }}
                        >
                           <span />
                        </button>
                     ))}
                  </div>
               );
            })}
            {waveform && (
               <TimelineWaveform
                  waveform={waveform}
                  clips={visible.clips}
                  from={drawn.start}
                  to={drawn.start + drawn.length}
                  width={viewportWidth}
                  dragging={dragging}
                  drawEdge={drawEdge}
               />
            )}
         </div>
      ),
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
         frameLevel,
         duration,
         document,
         waveform,
         viewportWidth,
         onSelect,
         onCommit,
         onSeek,
         dragging,
         drawEdge,
         keyframes,
         cancel,
         startDrag,
         moveDrag,
         endDrag,
         x,
      ]
   );
   // Edges fade through a mask on the viewport itself instead of painted overlays, so the
   // ruler, handles, and playhead all fade no matter their stacking order. The fade stops
   // reuse the spans computed for the ruler above.
   const px = (value: number) => `${+value.toFixed(2)}px`;
   let edgeMask: string | undefined;
   if (leftStop || rightStop) {
      const stops: string[] = [];
      if (leftStop) stops.push(`rgba(0,0,0,0) ${px(leftStop * 0.18)}`, `#000 ${px(leftStop)}`);
      stops.push(rightStop ? `#000 calc(100% - ${px(rightStop)})` : "#000");
      if (rightStop) stops.push(`rgba(0,0,0,0) calc(100% - ${px(rightStop * 0.18)})`);
      edgeMask = `linear-gradient(to right, ${stops.join(", ")})`;
   }
   return (
      <section className="timeline-section" aria-label="Clip timeline" ref={section}>
         <div
            className={`timeline-viewport${panActive ? " panning" : ""}`}
            ref={viewport}
            style={edgeMask ? { WebkitMaskImage: edgeMask, maskImage: edgeMask } : undefined}
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
               if (scrubbing.current === event.pointerId) onSeek(scrubTarget(event.clientX), false, false, undefined, pointAt(event.clientX));
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
               onSeek(scrubTarget(event.clientX), false, false, undefined, pointAt(event.clientX));
            }}
            onPointerUp={(event) => {
               // Pointer moves can be coalesced while decoding. Honor the release
               // position even when the final move was not delivered.
               if (scrubbing.current === event.pointerId) onSeek(scrubTarget(event.clientX), false, false, undefined, pointAt(event.clientX));
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
            <TimelinePlayhead
               clock={clock}
               duration={duration}
               frameStep={frameStep}
               playing={playing}
               drawnStart={drawnStart}
               drawnLength={drawnLength}
               dragging={!!dragging}
               dragBoundary={dragging ? dragDrawTime : null}
               dragKey={dragging ? `${dragging.id}:${dragging.side}` : null}
               dragMoved={dragMoved}
               scrubbingRef={scrubbing}
               dragRef={drag}
            />
            {dragging &&
               dragMoved &&
               (() => {
                  // Live readout of how much the drag added to or removed from the clip,
                  // floating at the moving boundary. Up close the frame count is the useful
                  // unit; a timestamp rounds away the frames being counted.
                  const dragged = visible.clips.find((clip) => clip.id === dragging.id);
                  if (!dragged) return null;
                  const original = dragging.original.clips.find((item) => item.id === dragging.id);
                  const delta = dragged.end - dragged.start - (original ? original.end - original.start : 0);
                  const frames = Math.round(Math.abs(delta) / frameStep);
                  const percent = clamp(((drawEdge - drawn.start) / drawn.length) * 100, 4, 96);
                  return (
                     <div className="drag-duration" style={{ left: `${percent}%` }} aria-hidden="true">
                        {delta < -timeEpsilon ? "−" : "+"}
                        {frameLevel ? `${frames} ${frames === 1 ? "frame" : "frames"}` : formatTime(Math.abs(delta))}
                     </div>
                  );
               })()}
         </div>
         <div className="timeline-handle-directions" aria-hidden="true">
            {visible.clips.flatMap((clip) =>
               (["start", "end"] as const).map((side) => {
                  const held = dragging?.id === clip.id && dragging.side === side;
                  const point = held ? drawEdge : clip[side];
                  const onScreen = point >= drawn.start && point <= drawn.start + drawn.length;
                  const active = onScreen && (held || (!dragging && hoveredEdge?.id === clip.id && hoveredEdge.side === side));
                  // Direction cues only earn their place when the clip is too small to show
                  // its handles clearly: their opacity ceiling fades in over the final
                  // stretch before the handles touch, starting at half that point.
                  const width =
                     ((dragging?.id === clip.id && dragging.side === "start" ? drawEdge : clip.start) -
                        (dragging?.id === clip.id && dragging.side === "end" ? drawEdge : clip.end)) *
                     -pxPerSecond;
                  const cap = clamp((28 - width) / 12, 0, 1);
                  return (
                     <span
                        key={`${clip.id}:${side}`}
                        className={`handle-direction ${side}${active ? " active" : ""}`}
                        style={{ left: x(point), "--clip-color": clipColor(clip.color), "--direction-cap": cap } as CSSProperties}
                     >
                        <FontAwesomeIcon icon={side === "start" ? faCaretLeft : faCaretRight} />
                     </span>
                  );
               })
            )}
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
// One canvas covers the viewport, with a clipped, tinted band for each kept range.
// Peak reduction and drawing run in the worker; React sends geometry only when it changes.
function TimelineWaveform({
   waveform,
   clips,
   from,
   to,
   width,
   dragging,
   drawEdge,
}: {
   waveform: Waveform;
   clips: Clip[];
   from: number;
   to: number;
   width: number;
   dragging: Drag | null;
   drawEdge: number;
}) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const ratio = window.devicePixelRatio || 1;
   const px = (width * ratio) / (to - from);
   const view = {
      width: Math.round(width * ratio),
      height: Math.round(23 * ratio),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      bands: clips.flatMap((clip) => {
         const start = Math.max(from, dragging?.id === clip.id && dragging.side === "start" ? drawEdge : clip.start);
         const end = Math.min(to, dragging?.id === clip.id && dragging.side === "end" ? drawEdge : clip.end);
         if (end <= start) return [];
         return [
            {
               from: start,
               to: end,
               left: (start - from) * px,
               width: (end - start) * px,
               color: clipColor(clip.color),
               // Keep the reveal visible when hours of recording fit on screen.
               fadeSeconds: (32 * ratio) / px,
            },
         ];
      }),
   };
   const latestView = useRef(view);
   latestView.current = view;
   useEffect(() => {
      const canvas = canvasRef.current!;
      return waveform.attach(canvas, latestView.current);
   }, [waveform]);
   useEffect(() => {
      const canvas = canvasRef.current!;
      waveform.update(canvas, view);
   });
   return <canvas key={waveform.id} ref={canvasRef} className="clip-waveform" aria-hidden="true" style={{ width: `${width}px` }} />;
}
// The playhead and time chip are the only per-frame UI in the timeline, so they subscribe to
// the clock inside their own subtree: playback re-renders just this leaf, never the whole
// Timeline. While a handle is dragged the leaf mirrors the Timeline's drag follower, so the
// line and the moving edge cannot drift apart.
function TimelinePlayhead({
   clock,
   duration,
   frameStep,
   playing,
   drawnStart,
   drawnLength,
   dragging,
   dragBoundary,
   dragKey,
   dragMoved,
   scrubbingRef,
   dragRef,
}: {
   clock: PlaybackClock;
   duration: number;
   frameStep: number;
   playing: boolean;
   drawnStart: number;
   drawnLength: number;
   dragging: boolean;
   dragBoundary: number | null;
   dragKey: string | null;
   dragMoved: boolean;
   scrubbingRef: RefObject<number | null>;
   dragRef: RefObject<Drag | null>;
}) {
   const time = useClock(clock);
   // Read at render time: scrubbing and drags flip refs without re-rendering the parent, but
   // every clock change re-renders here, so the mode below is always seen fresh.
   const pointerDriven = scrubbingRef.current !== null || dragRef.current !== null;
   // While playback runs, the drawn time snaps straight to the clock: the picture jumps on a
   // seek, and a gliding playhead would land after the content it points at. During a drag
   // the Timeline's follower has already smoothed the boundary, so the leaf mirrors it
   // exactly. Below the jump threshold a retarget snaps instead of tweening, so frame
   // stepping stays 1:1 — unless the seek asked to glide (discrete navigation such as
   // keyframe and clip jumps), which tweens regardless.
   const drawTime = useSmoothValue(dragging ? (dragBoundary ?? 0) : time, {
      ...(dragging
         ? { snap: () => true }
         : {
              ...(pointerDriven ? { follow: pointerSmoothingMs } : { duration: 170, jump: Math.max(frameStep * 1.5, 0.05), glide: clock.getGlide }),
              snap: () => playing,
           }),
      key: dragging && dragKey ? "drag:" + dragKey : (scrubbingRef.current ?? "idle"),
   });
   return (
      <>
         {drawTime >= drawnStart && drawTime <= drawnStart + drawnLength && (
            <div className="playhead" data-trimming={dragging && dragMoved} style={{ left: `${((drawTime - drawnStart) / drawnLength) * 100}%` }}>
               <span />
               <i />
            </div>
         )}
         <div className="timeline-time" aria-label="Playback time">
            <time>{formatTime(time)}</time>
            <span>/</span>
            <time>{formatTime(duration)}</time>
         </div>
      </>
   );
}
