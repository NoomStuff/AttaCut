import { useEffect, useReducer, useRef, useState } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const pointerSmoothingMs = 20;

interface SmoothOptions {
   /** How long easing across a jump takes. */
   duration?: number;
   /** Time constant in ms for continuous input; retargeting never restarts the frame loop. */
   follow?: number;
   /** Deltas smaller than this snap without animating, so continuous motion stays 1:1. */
   jump?: number;
   /** Return true to snap for this update, e.g. while the value is under pointer control. */
   snap?: () => boolean;
   /** When the key changes, snap to the target instead of easing (e.g. a new drag session). */
   key?: string | number;
}

/**
 * Tweens discrete changes or follows continuous input with frame-rate-independent damping.
 * The loop self-schedules across frames and consumes its slot at tick entry, so a stale slot
 * id can never block a restart and the chain can never freeze mid-tween. Snap and key changes
 * hand control over immediately.
 */
export function useSmoothValue(target: number, options: SmoothOptions = {}): number {
   const [, render] = useReducer((count: number) => count + 1, 0);
   const optionsRef = useRef(options);
   optionsRef.current = options;
   const display = useRef(target);
   const targetRef = useRef(target);
   const keyRef = useRef<string | number | undefined>(options.key);
   const run = useRef<{ from: number; start: number; last: number } | null>(null);
   const frame = useRef(0);

   if (target !== targetRef.current) {
      targetRef.current = target;
      const { jump = 0, snap, follow } = optionsRef.current;
      const immediate = reducedMotion() || Math.abs(target - display.current) < jump || (snap?.() ?? false);
      if (immediate) {
         cancelAnimationFrame(frame.current);
         frame.current = 0;
         run.current = null;
         display.current = target;
      } else if (!follow || !run.current) {
         const now = performance.now();
         run.current = { from: display.current, start: now, last: now };
      }
   }
   if (optionsRef.current.key !== keyRef.current) {
      keyRef.current = optionsRef.current.key;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      run.current = null;
      display.current = targetRef.current;
   }

   useEffect(() => {
      if (!run.current || frame.current) return;
      const tick = (now: number) => {
         // Consume the slot before anything else: once this tick runs, its id is history and
         // can never block the effect from scheduling a successor.
         frame.current = 0;
         const current = run.current;
         if (!current) return;
         const { duration = 170, follow } = optionsRef.current;
         let finished: boolean;
         if (follow) {
            const elapsed = Math.max(0, now - current.last);
            current.last = Math.max(current.last, now);
            display.current += (targetRef.current - display.current) * (1 - Math.exp(-elapsed / follow));
            finished = Math.abs(targetRef.current - display.current) < 0.00001;
         } else {
            // A queued frame can precede the event that retargeted this tween.
            const progress = Math.min(1, Math.max(0, (now - current.start) / duration));
            display.current = current.from + (targetRef.current - current.from) * (1 - (1 - progress) ** 3);
            finished = progress === 1;
         }
         if (finished) {
            display.current = targetRef.current;
            run.current = null;
         } else {
            frame.current = requestAnimationFrame(tick);
         }
         render();
      };
      frame.current = requestAnimationFrame(tick);
   });
   useEffect(
      () => () => {
         cancelAnimationFrame(frame.current);
         frame.current = 0;
      },
      []
   );

   return display.current;
}

/**
 * Keeps a value mounted for `ms` after it turns null so its exit animation can play.
 * While closing, `value` holds the last non-null value for rendering.
 */
export function useExitValue<T>(value: T | null, ms = 140): { value: T | null; mounted: boolean; closing: boolean } {
   const [state, setState] = useState<{ value: T | null; mounted: boolean; closing: boolean }>({
      value,
      mounted: value !== null,
      closing: false,
   });
   useEffect(() => {
      if (value !== null) {
         setState({ value, mounted: true, closing: false });
         return;
      }
      setState((current) => (current.mounted ? { value: current.value, mounted: true, closing: true } : current));
      const timer = window.setTimeout(() => setState({ value: null, mounted: false, closing: false }), ms);
      return () => window.clearTimeout(timer);
   }, [value, ms]);
   return state;
}

/**
 * Delegated press feedback: a soft circle expands from the click point on every button
 * except drag surfaces, which need their pointer events uninterrupted. Buttons also release
 * focus after pointer use so keyboard highlights only ever follow keyboard navigation.
 */
export function usePressFeedback(): void {
   useEffect(() => {
      const usable = (target: EventTarget | null): HTMLButtonElement | null => {
         if (!(target instanceof Element)) return null;
         const button = target.closest("button");
         // Binding chips and the capture field hold keyboard focus for recording; never ripple or
         // blur them, or key capture dies on pointerup before the keys arrive.
         if (
            !button ||
            button.disabled ||
            button.classList.contains("trim-handle") ||
            button.classList.contains("shortcut-binding") ||
            button.classList.contains("shortcut-capture")
         )
            return null;
         return button;
      };
      const navigation = (event: KeyboardEvent) => {
         if (event.key === "Tab") document.documentElement.dataset.keyboard = "true";
      };
      const pointerMode = () => {
         delete document.documentElement.dataset.keyboard;
      };
      let pressed: { button: HTMLButtonElement; pointerId: number } | null = null;
      const finishPress = () => {
         if (!pressed) return;
         const { button } = pressed;
         pressed = null;
         button.classList.add("releasing");
         if (document.activeElement === button) button.blur();
      };
      const press = (event: PointerEvent) => {
         if (event.button !== 0 || !event.isPrimary) return;
         const button = usable(event.target);
         if (!button) return;
         const rect = button.getBoundingClientRect();
         const x = event.clientX - rect.left;
         const y = event.clientY - rect.top;
         const reach = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
         button.style.setProperty("--press-x", `${x}px`);
         button.style.setProperty("--press-y", `${y}px`);
         button.style.setProperty("--press-reach", `${Math.ceil(reach)}px`);
         finishPress();
         button.classList.remove("pressing", "releasing");
         void button.offsetWidth;
         button.classList.add("pressing");
         pressed = { button, pointerId: event.pointerId };
      };
      const release = (event: PointerEvent) => {
         if (event.type === "pointerup" && event.button !== 0) return;
         if (pressed?.pointerId === event.pointerId) finishPress();
      };
      const settle = (event: AnimationEvent) => {
         if (event.animationName === "press-release" && event.target instanceof Element) event.target.classList.remove("pressing", "releasing");
      };
      document.addEventListener("keydown", navigation, true);
      document.addEventListener("pointerdown", pointerMode, true);
      document.addEventListener("pointerdown", press);
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", release, true);
      window.addEventListener("blur", finishPress);
      document.addEventListener("animationend", settle, true);
      return () => {
         document.removeEventListener("keydown", navigation, true);
         document.removeEventListener("pointerdown", pointerMode, true);
         document.removeEventListener("pointerdown", press);
         window.removeEventListener("pointerup", release, true);
         window.removeEventListener("pointercancel", release, true);
         window.removeEventListener("blur", finishPress);
         pressed?.button.classList.remove("pressing", "releasing");
         document.removeEventListener("animationend", settle, true);
      };
   }, []);
}
