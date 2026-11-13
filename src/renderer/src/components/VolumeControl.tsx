import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { faVolumeHigh, faVolumeLow, faVolumeOff, faVolumeXmark } from "@fortawesome/free-solid-svg-icons";
import { IconButton } from "./Controls";
import { VolumeSlider } from "./VolumeSlider";

const volumeStep = 0.05;

export function VolumeControl({ volume, muted, onChange }: { volume: number; muted: boolean; onChange: (value: number, restore: number) => void }) {
   const silent = muted || volume === 0;
   const icon = silent ? faVolumeXmark : volume < 0.33 ? faVolumeOff : volume < 0.67 ? faVolumeLow : faVolumeHigh;
   const root = useRef<HTMLDivElement>(null);
   const previousSilent = useRef(silent);
   const closeTimer = useRef(0);
   const [hovered, setHovered] = useState(false);
   useEffect(() => () => window.clearTimeout(closeTimer.current), []);
   // Scrolling over the button or the slider steps the volume. The listener is native and
   // not passive so the wheel never also zooms or scrolls whatever sits behind it.
   const latest = useRef({ volume, muted, onChange });
   latest.current = { volume, muted, onChange };
   useEffect(() => {
      const element = root.current;
      if (!element) return;
      // One scroll gesture remembers the level it started from, so scrolling down to
      // silence restores it on unmute like dragging the slider does. The unrounded level
      // carries through the gesture so small trackpad deltas still add up.
      let gesture: { restore: number; level: number } | null = null;
      let settle = 0;
      const wheel = (event: WheelEvent) => {
         if (!event.deltaY) return;
         event.preventDefault();
         event.stopPropagation();
         const { volume: current, muted: silent, onChange: change } = latest.current;
         const shown = silent ? 0 : current;
         gesture ??= { restore: current, level: shown };
         window.clearTimeout(settle);
         settle = window.setTimeout(() => (gesture = null), 400);
         // A mouse notch moves 5%; trackpads report pixels and move proportionally.
         const notches = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY / 3 : event.deltaY / 100;
         gesture.level = Math.min(1, Math.max(0, gesture.level - notches * volumeStep));
         const next = Math.round(gesture.level * 100) / 100;
         if (next !== shown) change(next, gesture.restore);
      };
      element.addEventListener("wheel", wheel, { passive: false });
      return () => {
         element.removeEventListener("wheel", wheel);
         window.clearTimeout(settle);
      };
   }, []);
   useLayoutEffect(() => {
      if (previousSilent.current === silent) return;
      previousSilent.current = silent;
      const element = root.current;
      if (!element) return;
      element.classList.remove("volume-state-changed");
      void element.offsetWidth;
      element.classList.add("volume-state-changed");
   }, [silent]);
   return (
      <div
         ref={root}
         className="volume-control"
         data-open={hovered ? "" : undefined}
         onPointerEnter={(event) => {
            if (event.pointerType === "touch") return;
            window.clearTimeout(closeTimer.current);
            setHovered(true);
         }}
         onPointerLeave={() => {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = window.setTimeout(() => setHovered(false), 350);
         }}
         onAnimationEnd={(event) => {
            if (event.animationName === "icon-wave" || event.animationName === "icon-rattle") root.current?.classList.remove("volume-state-changed");
         }}
      >
         <IconButton command="mute" icon={icon} label={silent ? "Unmute preview" : "Mute preview"} />
         <div className="volume-popover">
            <div className="volume-popover-panel">
               <VolumeSlider volume={volume} muted={muted} onChange={onChange} />
            </div>
         </div>
      </div>
   );
}
