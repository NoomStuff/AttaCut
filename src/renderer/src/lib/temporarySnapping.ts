import { useEffect, useState } from "react";
import type { Preferences } from "../../../shared/types";

/** Holding the chosen modifier never changes the saved snapping preference. */
export function useTemporarySnapping(blocked: boolean, modifier: Preferences["holdToSnap"]): boolean {
   const [held, setHeld] = useState(false);
   useEffect(() => {
      setHeld(false);
      if (blocked || modifier === "none") return;
      const down = (event: KeyboardEvent) => {
         if (
            event.key !== modifier ||
            (event.ctrlKey && modifier !== "Control") ||
            event.metaKey ||
            event.isComposing ||
            document.querySelector('dialog[open], [data-editor-shortcuts="blocked"]') ||
            (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))
         )
            return;
         event.preventDefault();
         setHeld(true);
      };
      const up = (event: KeyboardEvent) => {
         const pressed = modifier === "Alt" ? event.altKey : modifier === "Shift" ? event.shiftKey : event.ctrlKey;
         if (event.key === modifier || !pressed) setHeld(false);
      };
      const clear = () => setHeld(false);
      const visibility = () => {
         if (document.hidden) clear();
      };
      window.addEventListener("keydown", down);
      window.addEventListener("keyup", up);
      window.addEventListener("blur", clear);
      document.addEventListener("visibilitychange", visibility);
      return () => {
         window.removeEventListener("keydown", down);
         window.removeEventListener("keyup", up);
         window.removeEventListener("blur", clear);
         document.removeEventListener("visibilitychange", visibility);
      };
   }, [blocked, modifier]);
   return held && !blocked;
}
