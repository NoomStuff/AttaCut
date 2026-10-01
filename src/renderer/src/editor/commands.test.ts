import { describe, expect, it } from "vitest";
import { resolvedCommand, bindingsFor, commandForBinding, displayBindings, bindingFromEvent } from "./commands";
import { preferencesSchema } from "../../../shared/types";

describe("multiple command bindings", () => {
   it("keeps shortcuts usable with the chosen held modifier without overriding explicit or standard bindings", () => {
      expect(commandForBinding("Shift+S", {}, "Shift")).toBe("split");
      expect(commandForBinding("Shift+.", {}, "Shift")).toBe("nextKeyframe");
      expect(commandForBinding("Mod+S", {}, "Mod")).toBe("split");
      expect(commandForBinding("Mod+Z", {}, "Mod")).toBe("undo");
      expect(commandForBinding("Ctrl+S", {}, "Ctrl")).toBe("split");
      expect(commandForBinding("Mod+C", {}, "Mod")).toBeUndefined();
      expect(commandForBinding("Shift+S", { delete: ["Shift+S"] }, "Shift")).toBe("delete");
      expect(commandForBinding("Alt+S", {}, false)).toBeUndefined();
   });
   it("lets Alt hold snapping through other shortcuts while explicit Alt bindings win", () => {
      expect(commandForBinding("Alt+S", {}, true)).toBe("split");
      expect(commandForBinding("alt+s", {}, true)).toBe("split");
      expect(commandForBinding("Mod+Alt+Z", {}, true)).toBe("undo");
      expect(commandForBinding("Alt+Shift+.", {}, true)).toBe("nextKeyframe");
      expect(commandForBinding("Alt+ArrowRight", {}, true)).toBe("nextKeyframe");
      expect(commandForBinding("Alt+S", { delete: ["Alt+S"] }, true)).toBe("delete");
      expect(commandForBinding("Alt+S", {})).toBeUndefined();
   });
   it("recognizes shifted frame keys even when the keyboard emits angle brackets", () => {
      for (const [key, code, expected] of [
         ["<", "Comma", "previousKeyframe"],
         [">", "Period", "nextKeyframe"],
      ] as const) {
         const binding = bindingFromEvent({ key, code, shiftKey: true } as KeyboardEvent, false);
         expect(commandForBinding(binding, {})).toBe(expected);
      }
      expect(commandForBinding("Alt+ArrowRight", {})).toBe("nextKeyframe");
      expect(commandForBinding("Mod+ArrowRight", {})).toBe("next");
   });
   it("uses defaults only when no override exists", () => {
      expect(bindingsFor("mute", {})).toEqual(["M"]);
      expect(bindingsFor("mute", { mute: [] })).toEqual([]);
      expect(commandForBinding("M", { mute: [] })).toBeUndefined();
   });
   it("matches every binding and releases removed defaults", () => {
      const overrides = { mute: ["J", "Mod+Shift+K", "Alt+L"] };
      for (const key of overrides.mute) expect(commandForBinding(key.toLowerCase(), overrides)).toBe("mute");
      expect(commandForBinding("M", overrides)).toBeUndefined();
      expect(displayBindings(overrides.mute, false)).toBe("J / Ctrl+Shift+K / Alt+L");
      expect(displayBindings([], false)).toBe("");
   });
   it("persists empty and multiple bindings without restoring defaults", () => {
      const preferences = preferencesSchema.parse({ shortcuts: { mute: [], split: ["S", "Alt+S"] } });
      expect(preferencesSchema.parse(JSON.parse(JSON.stringify(preferences))).shortcuts).toEqual({ mute: [], split: ["S", "Alt+S"] });
   });
});

describe("resolved commands", () => {
   it("uses the current valid action when execution follows a state change", () => {
      const remaining = ["a", "b"];
      const deleted: string[] = [];
      const command = resolvedCommand(() => {
         const target = remaining[0];
         return target
            ? () => {
                 deleted.push(target);
                 remaining.shift();
              }
            : undefined;
      });
      expect(command.enabled()).toBe(true);
      command.run();
      expect(command.enabled()).toBe(true);
      command.run();
      expect(command.enabled()).toBe(false);
      command.run();
      expect(deleted).toEqual(["a", "b"]);
   });
});
