import { useCallback, useEffect, useState } from "react";

export type FullscreenState = "off" | "on" | "returning";

/**
 * The player overlays the window while the window itself takes over the screen, so the
 * custom controls stay, and window management, multi-monitor layouts and background
 * presentation behave the same in and out. Native fullscreen changes immediately; the
 * "returning" state only covers the windowed preview's exit animation.
 */
export function useFullscreen(hasPlayer: boolean) {
   const [state, setState] = useState<FullscreenState>("off");
   const presented = state === "on";
   const setFullscreen = useCallback((value: boolean | ((current: boolean) => boolean)) => {
      setState((current) => {
         const next = typeof value === "function" ? value(current === "on") : value;
         return next ? "on" : current === "off" ? "off" : "returning";
      });
   }, []);
   const finishReturn = useCallback(() => {
      setState((current) => (current === "returning" ? "off" : current));
   }, []);
   useEffect(
      () =>
         window.desktop.onWindowFullscreen((value) => {
            // Native exits have already resized the window. A late enter notification
            // must not cancel an exit the user requested while the window was entering.
            setState((current) => (value ? (current === "returning" ? current : "on") : current === "on" ? "returning" : current));
         }),
      []
   );
   useEffect(() => {
      // A removed player or reduced-motion mode has no exit animation to await.
      if (state !== "returning") return;
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const finishWithoutMotion = () => {
         if (!hasPlayer || motion.matches) finishReturn();
      };
      finishWithoutMotion();
      motion.addEventListener("change", finishWithoutMotion);
      return () => motion.removeEventListener("change", finishWithoutMotion);
   }, [state, hasPlayer, finishReturn]);
   useEffect(() => {
      window.desktop.windowAction(presented ? "enterFullscreen" : "exitFullscreen");
   }, [presented]);
   return { presented, returning: state === "returning", setFullscreen, finishReturn };
}
