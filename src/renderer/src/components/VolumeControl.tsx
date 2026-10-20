import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { faVolumeHigh, faVolumeXmark } from "@fortawesome/free-solid-svg-icons";
import { IconButton } from "./Controls";
import { VolumeSlider } from "./VolumeSlider";

export function VolumeControl({ volume, muted, onChange }: { volume: number; muted: boolean; onChange: (value: number, restore: number) => void }) {
   const silent = muted || volume === 0;
   const root = useRef<HTMLDivElement>(null);
   const previousSilent = useRef(silent);
   const closeTimer = useRef(0);
   const [hovered, setHovered] = useState(false);
   useEffect(() => () => window.clearTimeout(closeTimer.current), []);
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
         <IconButton command="mute" icon={silent ? faVolumeXmark : faVolumeHigh} label={silent ? "Unmute preview" : "Mute preview"} />
         <div className="volume-popover">
            <div className="volume-popover-panel">
               <VolumeSlider volume={volume} muted={muted} onChange={onChange} />
            </div>
         </div>
      </div>
   );
}
