/**
 * Focus rings, keyboard menu highlights and focus tooltips are for people moving through the app
 * by keyboard. Tab always counts. Arrows, Home, End, Enter and Space count when they act on a
 * focused control. An app shortcut never does, so Space or the arrows after a click leave no ring.
 */

/** Key presses the app took as one of its shortcuts. */
const shortcuts = new WeakSet<Event>();
export function markShortcut(event: KeyboardEvent): void {
   shortcuts.add(event);
}

/** Keys that move focus or act on the focused control. Tab always does. */
const navigation = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " "]);
const textEntry = 'textarea, [contenteditable="true"], input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"])';

/** Whether this key press is someone navigating by keyboard. Pure, given whether the app used it as a shortcut. */
export function navigatesByKeyboard(
   event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
   target: Element | null,
   shortcut: boolean,
   focusedControl: boolean
): boolean {
   if (event.key === "Tab") return true;
   if (!focusedControl || shortcut || event.ctrlKey || event.metaKey || event.altKey || !navigation.has(event.key)) return false;
   // Arrows, Home and End inside a text field move the caret, and Space types.
   return !target?.closest(textEntry);
}

/** Whether keyboard mode is on, which a focused control's own key handling can ask. */
export function keyboardMode(root: HTMLElement = document.documentElement): boolean {
   return root.hasAttribute("data-keyboard");
}

export function installKeyboardMode(root: HTMLElement = document.documentElement): void {
   document.addEventListener(
      "keydown",
      (event) => {
         const target = event.target instanceof Element ? event.target : null;
         // With nothing focused, a key has no control to act on.
         const focusedControl = !!target && target !== document.body && target !== document.documentElement;
         // The shortcut handler runs after this capture listener, so the decision waits for it.
         setTimeout(() => {
            if (navigatesByKeyboard(event, target, shortcuts.has(event), focusedControl)) root.dataset["keyboard"] = "true";
         });
      },
      true
   );
   document.addEventListener(
      "pointerdown",
      () => {
         delete root.dataset["keyboard"];
      },
      true
   );
}
