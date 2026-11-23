import { describe, expect, it } from "vitest";
import { navigatesByKeyboard } from "./keyboardMode";

const key = (value: string, modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">> = {}) => ({
   key: value,
   ctrlKey: false,
   metaKey: false,
   altKey: false,
   ...modifiers,
});
// Enough of an element for closest(): a text field or not.
const element = (text: boolean) => ({ closest: () => (text ? {} : null) }) as unknown as Element;

describe("keyboard navigation", () => {
   it("counts Tab, even from a text field or with nothing focused", () => {
      expect(navigatesByKeyboard(key("Tab"), element(true), false, true)).toBe(true);
      expect(navigatesByKeyboard(key("Tab"), null, false, false)).toBe(true);
   });
   it("counts arrows, Enter and Space that act on the focused control", () => {
      expect(navigatesByKeyboard(key("ArrowDown"), element(false), false, true)).toBe(true);
      expect(navigatesByKeyboard(key("Enter"), element(false), false, true)).toBe(true);
      expect(navigatesByKeyboard(key(" "), element(false), false, true)).toBe(true);
   });
   it("ignores the app's shortcuts, even on navigation keys", () => {
      expect(navigatesByKeyboard(key("ArrowLeft"), element(false), true, true)).toBe(false);
      expect(navigatesByKeyboard(key(" "), element(false), true, true)).toBe(false);
      expect(navigatesByKeyboard(key("c", { ctrlKey: true }), element(false), false, true)).toBe(false);
   });
   it("ignores navigation keys with no focused control", () => {
      expect(navigatesByKeyboard(key("ArrowDown"), element(false), false, false)).toBe(false);
   });
   it("ignores letters and keys that only edit text", () => {
      expect(navigatesByKeyboard(key("m"), element(false), false, true)).toBe(false);
      expect(navigatesByKeyboard(key("ArrowLeft"), element(true), false, true)).toBe(false);
      expect(navigatesByKeyboard(key(" "), element(true), false, true)).toBe(false);
   });
});
