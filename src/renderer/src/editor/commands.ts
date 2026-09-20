import { createContext, useEffect, useRef } from "react";
export const commandDefinitions = {
   open: { label: "Import video", bindings: ["Mod+O"], group: "File" },
   export: { label: "Export", bindings: ["Mod+E"], group: "File" },
   frame: { label: "Export current frame", bindings: ["Mod+Shift+E"], group: "File" },
   play: { label: "Play / pause", bindings: ["Space"], group: "Playback" },
   frameBack: { label: "Previous frame", bindings: [","], group: "Playback", repeat: true },
   frameForward: { label: "Next frame", bindings: ["."], group: "Playback", repeat: true },
   mute: { label: "Toggle mute playback", bindings: ["M"], group: "Playback" },
   snap: { label: "Snap to keyframes", bindings: ["C"], group: "Clips" },
   merge: { label: "Merge clips", bindings: ["E"], group: "Clips" },
   toggleClip: { label: "Toggle clip at playhead", bindings: ["W"], group: "Clips" },
   preview: { label: "Preview selected clip", bindings: ["P"], group: "Playback" },
   back: { label: "Back one second", bindings: ["ArrowLeft"], group: "Playback", repeat: true },
   forward: { label: "Forward one second", bindings: ["ArrowRight"], group: "Playback", repeat: true },
   backFast: { label: "Back five seconds", bindings: ["Shift+ArrowLeft"], group: "Playback", repeat: true },
   forwardFast: { label: "Forward five seconds", bindings: ["Shift+ArrowRight"], group: "Playback", repeat: true },
   previous: { label: "Previous clip", bindings: ["Alt+ArrowLeft"], group: "Clips" },
   next: { label: "Next clip", bindings: ["Alt+ArrowRight"], group: "Clips" },
   split: { label: "Split at playhead", bindings: ["S"], group: "Clips" },
   setStart: { label: "Trim left", bindings: ["A"], group: "Clips" },
   setEnd: { label: "Trim right", bindings: ["D"], group: "Clips" },
   delete: { label: "Delete selected clip", bindings: ["Delete"], group: "Clips" },
   add: { label: "Add clip in gap", bindings: [], group: "Clips" },
   undo: { label: "Undo", bindings: ["Mod+Z"], group: "Edit" },
   redo: { label: "Redo", bindings: ["Mod+Shift+Z"], group: "Edit" },
   fit: { label: "Fit timeline", bindings: ["F"], group: "View" },
   zoomIn: { label: "Zoom in", bindings: ["="], group: "View" },
   zoomOut: { label: "Zoom out", bindings: ["-"], group: "View" },
   settings: { label: "Settings", bindings: ["Mod+,"], group: "View" },
   help: { label: "Help", bindings: ["F1"], group: "Help" },
   shortcuts: { label: "Keyboard shortcuts", bindings: ["/"], group: "Help" },
   about: { label: "About", bindings: [], group: "Help" },
} as const;
export type CommandId = keyof typeof commandDefinitions;
export interface Command {
   feedback?: () => CommandId;
   enabled: () => boolean;
   run: () => void;
}
/** Availability and execution resolve the same current action, including after another edit. */
export function resolvedCommand(resolve: () => (() => void) | undefined): Command {
   return { enabled: () => !!resolve(), run: () => resolve()?.() };
}
export type Commands = Record<CommandId, Command>;
export const CommandContext = createContext<{ commands: Commands; overrides: Record<string, string[]>; mac: boolean } | null>(null);
export function isCommandId(id: string): id is CommandId {
   return Object.hasOwn(commandDefinitions, id);
}
export function bindingsFor(id: CommandId, overrides: Record<string, string[]>): readonly string[] {
   return overrides[id] ?? commandDefinitions[id].bindings;
}
export function commandForBinding(binding: string, overrides: Record<string, string[]>): CommandId | undefined {
   return (Object.keys(commandDefinitions) as CommandId[]).find((id) => bindingsFor(id, overrides).some((key) => key.toUpperCase() === binding.toUpperCase()));
}
export function displayBindings(bindings: readonly string[], mac: boolean): string {
   return bindings.map((binding) => displayBinding(binding, mac)).join(" / ");
}
export function displayBinding(binding: string, mac: boolean): string {
   return binding
      .replace("Mod", mac ? "⌘" : "Ctrl")
      .replaceAll("ArrowLeft", "←")
      .replaceAll("ArrowRight", "→");
}
export function bindingFromEvent(event: KeyboardEvent, mac: boolean): string {
   const parts: string[] = [];
   if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
   if (mac ? event.ctrlKey : event.metaKey) parts.push(mac ? "Ctrl" : "Meta");
   if (event.altKey) parts.push("Alt");
   if (event.shiftKey && (event.key.length > 1 || /[a-z]/i.test(event.key))) parts.push("Shift");
   parts.push(event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key);
   return parts.join("+");
}
export function useCommands(commands: Commands, overrides: Record<string, string[]>, mac: boolean, blocked: boolean): void {
   const latest = useRef({ commands, overrides, mac, blocked });
   latest.current = { commands, overrides, mac, blocked };
   useEffect(() => {
      let keyboardFocus = false;
      const pointer = () => {
         keyboardFocus = false;
      };
      const execute = (id: string) => {
         // The dialog's open attribute clears the moment a panel dismisses, even though its
         // exit fade still renders, so shortcuts work again immediately.
         if (!isCommandId(id) || latest.current.blocked || document.querySelector("dialog[open]")) return;
         const command = latest.current.commands[id];
         if (command.enabled()) {
            const feedbackId = command.feedback?.() ?? id;
            document.querySelectorAll<HTMLElement>(`[data-command="${feedbackId}"]`).forEach((button) => {
               button.classList.remove("shortcut-active");
               void button.offsetWidth;
               button.classList.add("shortcut-active");
               window.setTimeout(() => button.classList.remove("shortcut-active"), 480);
            });
            command.run();
         }
      };
      const handler = (event: KeyboardEvent) => {
         if (event.key === "Tab") keyboardFocus = true;
         const target = event.target;
         if (
            latest.current.blocked ||
            document.querySelector("dialog[open]") ||
            event.isComposing ||
            (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true]"))
         )
            return;
         if (
            target instanceof HTMLElement &&
            target.closest("[role=slider]") &&
            ["ArrowLeft", "ArrowRight"].includes(event.key) &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey
         )
            return;
         const binding = bindingFromEvent(event, latest.current.mac);
         const id = commandForBinding(binding, latest.current.overrides);
         if (!id || !latest.current.commands[id].enabled()) return;
         event.preventDefault();
         // App shortcuts should not turn a mouse-focused button into a keyboard target.
         if (!keyboardFocus && target instanceof HTMLElement && target.closest("button")) target.blur();
         const definition = commandDefinitions[id];
         if (event.repeat && !("repeat" in definition && definition.repeat)) return;
         execute(id);
      };
      window.addEventListener("keydown", handler);
      window.addEventListener("pointerdown", pointer);
      const unsubscribe = window.desktop.onCommand(execute);
      return () => {
         window.removeEventListener("keydown", handler);
         window.removeEventListener("pointerdown", pointer);
         unsubscribe();
      };
   }, []);
}
