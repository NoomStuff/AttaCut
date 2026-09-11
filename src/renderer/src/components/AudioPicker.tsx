import { useEffect, useRef, useState } from "react";
import type { MediaStream } from "../../../shared/types";
import { faHeadphones, faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IconButton } from "./Controls";
import { useExitValue } from "../lib/motion";

export function AudioPicker({ tracks, selected, onSelect }: { tracks: MediaStream[]; selected: number | null; onSelect: (index: number) => void }) {
   const [open, setOpen] = useState(false);
   const ref = useRef<HTMLDivElement>(null);
   const menu = useExitValue(open && tracks.length > 0 ? true : null, 120);
   useEffect(() => {
      if (!open) return;
      ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
      const outside = (event: PointerEvent) => {
         if (!ref.current?.contains(event.target as Node)) setOpen(false);
      };
      window.addEventListener("pointerdown", outside);
      return () => window.removeEventListener("pointerdown", outside);
   }, [open]);
   const close = () => {
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
   };
   return (
      <div className="audio-picker" ref={ref}>
         <IconButton
            icon={faHeadphones}
            label="Change preview audio track"
            disabled={tracks.length === 0}
            aria-haspopup="menu"
            aria-expanded={open}
            active={open}
            onClick={() => setOpen(!open)}
         />
         {menu.mounted && menu.value && (
            <div
               className={`audio-menu${menu.closing ? " closing" : ""}`}
               role="menu"
               aria-label="Preview audio tracks"
               onKeyDown={(event) => {
                  if (event.key === "Escape") {
                     event.stopPropagation();
                     close();
                  }
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                     event.preventDefault();
                     event.stopPropagation();
                     const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                     const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                     buttons[
                        event.key === "Home"
                           ? 0
                           : event.key === "End"
                             ? buttons.length - 1
                             : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
                     ]?.focus();
                  }
               }}
            >
               {tracks.map((track, index) => (
                  <button
                     key={track.index}
                     role="menuitemradio"
                     aria-checked={track.index === selected}
                     onClick={() => {
                        onSelect(track.index);
                        close();
                     }}
                  >
                     <span>{track.title || `Track ${index + 1}`}</span>
                     {track.index === selected && <FontAwesomeIcon icon={faCheck} />}
                  </button>
               ))}
            </div>
         )}
      </div>
   );
}
