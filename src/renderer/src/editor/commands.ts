import { useEffect, useRef } from "react";
export const commandDefinitions = {
   open: { label: "Import video", binding: "Mod+O", group: "File" },
   export: { label: "Export clips", binding: "Mod+E", group: "File" },
   frame: { label: "Export current frame", binding: "Mod+Shift+E", group: "File" },
   play: { label: "Play / pause", binding: "Space", group: "Playback" },
   preview: { label: "Preview selected clip", binding: "P", group: "Playback" },
   back: { label: "Back one second", binding: "ArrowLeft", group: "Playback", repeat: true },
   forward: { label: "Forward one second", binding: "ArrowRight", group: "Playback", repeat: true },
   backFast: { label: "Back five seconds", binding: "Shift+ArrowLeft", group: "Playback", repeat: true },
   forwardFast: { label: "Forward five seconds", binding: "Shift+ArrowRight", group: "Playback", repeat: true },
   previous: { label: "Previous clip", binding: "Alt+ArrowLeft", group: "Clips" },
   next: { label: "Next clip", binding: "Alt+ArrowRight", group: "Clips" },
   split: { label: "Split at playhead", binding: "S", group: "Clips" },
   setStart: { label: "Set start here", binding: "I", group: "Clips" },
   setEnd: { label: "Set end here", binding: "O", group: "Clips" },
   delete: { label: "Delete selected clip", binding: "Delete", group: "Clips" },
   add: { label: "Add clip in gap", binding: "", group: "Clips" },
   undo: { label: "Undo", binding: "Mod+Z", group: "Edit" },
   redo: { label: "Redo", binding: "Mod+Shift+Z", group: "Edit" },
   fit: { label: "Fit timeline", binding: "F", group: "View" },
   zoomIn: { label: "Zoom in", binding: "=", group: "View" },
   zoomOut: { label: "Zoom out", binding: "-", group: "View" },
   settings: { label: "Settings", binding: "Mod+,", group: "View" },
   shortcuts: { label: "Keyboard shortcuts", binding: "?", group: "Help" },
   about: { label: "About", binding: "", group: "Help" },
} as const;
export type CommandId = keyof typeof commandDefinitions;
export interface Command {
   enabled: () => boolean;
   run: () => void;
}
export type Commands = Record<CommandId, Command>;
export function isCommandId(id: string): id is CommandId {
   return Object.hasOwn(commandDefinitions, id);
}
export function bindingFor(id: CommandId, overrides: Record<string, string>): string {
   return overrides[id] ?? commandDefinitions[id].binding;
}
export function displayBinding(binding: string, mac: boolean): string {
   return binding
      .replace("Mod", mac ? "⌘" : "Ctrl")
      .replaceAll("ArrowLeft", "←")
      .replaceAll("ArrowRight", "→")
      .replaceAll("+", " ");
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
export function useCommands(commands: Commands, overrides: Record<string, string>, mac: boolean, blocked: boolean): void {
   const latest = useRef({ commands, overrides, mac, blocked });
   latest.current = { commands, overrides, mac, blocked };
   useEffect(() => {
      let keyboardFocus = false;
      const pointer = () => {
         keyboardFocus = false;
      };
      const execute = (id: string) => {
         if (!isCommandId(id) || latest.current.blocked) return;
         const command = latest.current.commands[id];
         if (command.enabled()) {
            command.run();
            const button = document.querySelector<HTMLElement>(`[data-command="${id}"]`);
            button?.animate([{ backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" }, { backgroundColor: "transparent" }], {
               duration: 180,
            });
         }
      };
      const handler = (event: KeyboardEvent) => {
         if (event.key === "Tab") keyboardFocus = true;
         const target = event.target;
         if (
            latest.current.blocked ||
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
         const id = (Object.keys(commandDefinitions) as CommandId[]).find(
            (key) => bindingFor(key, latest.current.overrides).toUpperCase() === binding.toUpperCase()
         );
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
