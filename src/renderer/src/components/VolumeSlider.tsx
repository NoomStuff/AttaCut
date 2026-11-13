import { useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { pointerSmoothingMs, useSmoothValue } from "../lib/motion";

// Matches the thumb inset in Transport.css, so the pointer and the thumb line up.
const thumbInset = 5;

/** Vertical volume slider. Pointer dragging is handled here rather than by the native range
 * input, whose track styling does not follow vertical writing modes. The input stays for
 * keyboard control and assistive technology. */
export function VolumeSlider({ volume, muted, onChange }: { volume: number; muted: boolean; onChange: (value: number, restore: number) => void }) {
   const gestureVolume = useRef<number | null>(null);
   const input = useRef<HTMLInputElement>(null);
   const displayed = useSmoothValue(muted ? 0 : volume, { follow: pointerSmoothingMs });
   const finish = () => {
      gestureVolume.current = null;
   };
   const level = (event: ReactPointerEvent<HTMLSpanElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const travel = bounds.height - thumbInset * 2;
      const value = travel > 0 ? (bounds.bottom - thumbInset - event.clientY) / travel : 0;
      return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
   };
   return (
      <span
         className="volume-slider"
         style={{ "--fill": `${displayed * 100}%`, "--volume": displayed } as CSSProperties}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            input.current?.focus({ preventScroll: true });
            gestureVolume.current = volume;
            onChange(level(event), volume);
         }}
         onPointerMove={(event) => {
            if (gestureVolume.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            onChange(level(event), gestureVolume.current);
         }}
         onPointerUp={finish}
         onPointerCancel={finish}
         onLostPointerCapture={finish}
      >
         <i aria-hidden="true" />
         <input
            ref={input}
            type="range"
            aria-label="Preview volume"
            aria-orientation="vertical"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
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
