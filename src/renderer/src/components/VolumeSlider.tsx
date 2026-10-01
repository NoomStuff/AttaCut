import { useRef } from "react";
import type { CSSProperties } from "react";
import { pointerSmoothingMs, useSmoothValue } from "../lib/motion";

export function VolumeSlider({ volume, muted, onChange }: { volume: number; muted: boolean; onChange: (value: number, restore: number) => void }) {
   const gestureVolume = useRef<number | null>(null);
   const displayed = useSmoothValue(muted ? 0 : volume, { follow: pointerSmoothingMs });
   const finish = () => {
      gestureVolume.current = null;
   };
   return (
      <span className="volume-slider" style={{ "--fill": `${displayed * 100}%`, "--volume": displayed } as CSSProperties}>
         <i aria-hidden="true" />
         <input
            type="range"
            aria-label="Preview volume"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onPointerDown={() => {
               gestureVolume.current = volume;
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onKeyDown={() => {
               gestureVolume.current ??= volume;
            }}
            onKeyUp={finish}
            onBlur={finish}
            onChange={(event) => onChange(Number(event.target.value), gestureVolume.current ?? volume)}
         />
      </span>
   );
}
