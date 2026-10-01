import { createContext, useEffect, useRef } from "react";
export const commandDefinitions = {
   open: { label: "Import video", bindings: ["Mod+O"], group: "File" },
   export: { label: "Export", bindings: ["Mod+E"], group: "File" },
   frame: { label: "Export current frame", bindings: ["Mod+Shift+E"], group: "File" },
   closeProject: { label: "Close project", bindings: [], group: "File" },
   quit: { label: "Quit AttaCut", bindings: [], group: "File" },
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
   previousKeyframe: { label: "Previous keyframe", bindings: ["Shift+,", "Alt+ArrowLeft"], group: "Playback", repeat: true },
   nextKeyframe: { label: "Next keyframe", bindings: ["Shift+.", "Alt+ArrowRight"], group: "Playback", repeat: true },
   previous: { label: "Previous cut", bindings: ["Mod+ArrowLeft"], group: "Clips" },
   next: { label: "Next cut", bindings: ["Mod+ArrowRight"], group: "Clips" },
   split: { label: "Split at playhead", bindings: ["S"], group: "Clips" },
   setStart: { label: "Trim left", bindings: ["A"], group: "Clips" },
   setEnd: { label: "Trim right", bindings: ["D"], group: "Clips" },
   delete: { label: "Delete selected clip", bindings: ["Delete"], group: "Clips" },
   add: { label: "Add clip in gap", bindings: [], group: "Clips" },
   undo: { label: "Undo", bindings: ["Mod+Z"], group: "Edit" },
   redo: { label: "Redo", bindings: ["Mod+Shift+Z"], group: "Edit" },
   fit: { label: "Fit timeline", bindings: ["F", "0"], group: "View" },
   zoomIn: { label: "Zoom in", bindings: ["="], group: "View" },
   zoomOut: { label: "Zoom out", bindings: ["-"], group: "View" },
   settings: { label: "Settings", bindings: ["Mod+,"], group: "View" },
   help: { label: "Help", bindings: ["F1"], group: "Help" },
   shortcuts: { label: "Keyboard shortcuts", bindings: ["/"], group: "Help" },
   releases: { label: "Releases page", bindings: [], group: "Help" },
   about: { label: "About", bindings: [], group: "Help" },
   reset: { label: "Factory reset", bindings: [], group: "Help" },
} as const;
export type CommandId = keyof typeof commandDefinitions;
export interface Command {
   resolve?: () => (() => void) | undefined;
   feedback?: () => CommandId;
   enabled: () => boolean;
   run: () => void;
}
/** Availability and execution resolve the same current action, including after another edit. */
export function resolvedCommand(resolve: () => (() => void) | undefined): Command {
   return { resolve, enabled: () => !!resolve(), run: () => resolve()?.() };
}
export type Commands = Record<CommandId, Command>;
/** Buttons, native menus and shortcuts all recheck availability before executing. */
export function guardCommands(commands: Commands): Commands {
   return Object.fromEntries(
      Object.entries(commands).map(([id, command]) => [
         id,
         command.resolve
            ? command
            : {
                 ...command,
                 ...resolvedCommand(() => (command.enabled() ? command.run : undefined)),
              },
      ])
   ) as Commands;
}
export const CommandContext = createContext<{
   commands: Commands;
   overrides: Record<string, string[]>;
   mac: boolean;
   holdToSnap?: "Alt" | "Shift" | "Control" | "none";
} | null>(null);
export function isCommandId(id: string): id is CommandId {
   return Object.hasOwn(commandDefinitions, id);
}
export function bindingsFor(id: CommandId, overrides: Record<string, string[]>): readonly string[] {
   return overrides[id] ?? commandDefinitions[id].bindings;
}
export function commandForBinding(binding: string, overrides: Record<string, string[]>, temporaryModifier: boolean | string = false): CommandId | undefined {
   const exact = (Object.keys(commandDefinitions) as CommandId[]).find((id) =>
      bindingsFor(id, overrides).some((key) => key.toUpperCase() === binding.toUpperCase())
   );
   if (exact || !temporaryModifier) return exact;
   // Explicit combinations win; otherwise the held snapping modifier leaves other shortcuts usable.
   const modifier = (temporaryModifier === true ? "Alt" : temporaryModifier).toUpperCase();
   if (modifier === "MOD" && /^MOD\+[ACVWXQ]$/i.test(binding)) return undefined;
   const parts = binding.split("+");
   return parts.some((part) => part.toUpperCase() === modifier)
      ? commandForBinding(parts.filter((part) => part.toUpperCase() !== modifier).join("+"), overrides)
      : undefined;
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
   // Shift changes these keys to < and > on many layouts. Keep the frame-key identity.
   const key = event.shiftKey && event.code === "Comma" ? "," : event.shiftKey && event.code === "Period" ? "." : event.key;
   const parts: string[] = [];
   if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
   if (mac ? event.ctrlKey : event.metaKey) parts.push(mac ? "Ctrl" : "Meta");
   if (event.altKey) parts.push("Alt");
   if (event.shiftKey && (key.length > 1 || /[a-z]/i.test(key) || key === "," || key === ".")) parts.push("Shift");
   parts.push(key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key);
   return parts.join("+");
}
export function useCommands(
   commands: Commands,
   overrides: Record<string, string[]>,
   mac: boolean,
   blocked: boolean,
   temporaryModifier: string | false = "Alt"
): void {
   const latest = useRef({ commands, overrides, mac, blocked, temporaryModifier });
   latest.current = { commands, overrides, mac, blocked, temporaryModifier };
   useEffect(() => {
      let keyboardFocus = false;
      const pointer = () => {
         keyboardFocus = false;
      };
      const execute = (id: string, resolved?: () => void) => {
         // The dialog's open attribute clears the moment a panel dismisses, even though its
         // exit fade still renders, so shortcuts work again immediately.
         if (!isCommandId(id) || latest.current.blocked || document.querySelector('dialog[open], [data-editor-shortcuts="blocked"]')) return;
         const command = latest.current.commands[id];
         const action = resolved ?? (command.resolve ? command.resolve() : command.enabled() ? command.run : undefined);
         if (action) {
            const feedbackId = command.feedback?.() ?? id;
            document.querySelectorAll<HTMLElement>(`[data-command="${feedbackId}"]`).forEach((button) => {
               button.classList.remove("shortcut-active");
               void button.offsetWidth;
               button.classList.add("shortcut-active");
               window.setTimeout(() => button.classList.remove("shortcut-active"), 480);
            });
            action();
         }
      };
      const handler = (event: KeyboardEvent) => {
         if (event.key === "Tab") keyboardFocus = true;
         const target = event.target;
         if (
            latest.current.blocked ||
            document.querySelector('dialog[open], [data-editor-shortcuts="blocked"]') ||
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
         const id = commandForBinding(binding, latest.current.overrides, latest.current.temporaryModifier);
         if (!id) return;
         const command = latest.current.commands[id];
         const action = command.resolve ? command.resolve() : command.enabled() ? command.run : undefined;
         if (!action) return;
         event.preventDefault();
         // App shortcuts should not turn a mouse-focused button into a keyboard target.
         if (!keyboardFocus && target instanceof HTMLElement && target.closest("button")) target.blur();
         const definition = commandDefinitions[id];
         if (event.repeat && !("repeat" in definition && definition.repeat)) return;
         execute(id, action);
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
