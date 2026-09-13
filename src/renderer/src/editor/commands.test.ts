import { describe, expect, it } from "vitest";
import { resolvedCommand, bindingsFor, commandForBinding, displayBindings } from "./commands";
import { preferencesSchema } from "../../../shared/types";

describe("multiple command bindings", () => {
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
