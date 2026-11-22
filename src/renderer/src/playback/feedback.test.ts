import { describe, expect, it } from "vitest";
import { formatSkip, skipStreakMs, steppedVolume, streakTotal } from "./feedback";

describe("skip indicator", () => {
   it("adds up quick repeats in the same direction", () => {
      expect(streakTotal({ seconds: 5, at: 1000 }, 5, 1000 + skipStreakMs - 1)).toBe(10);
   });
   it("starts over after a pause or a change of direction", () => {
      expect(streakTotal({ seconds: 5, at: 1000 }, 5, 1000 + skipStreakMs)).toBe(5);
      expect(streakTotal({ seconds: 5, at: 1000 }, -1, 1100)).toBe(-1);
      expect(streakTotal(null, -1, 0)).toBe(-1);
   });
   it("shows whole seconds, and minutes past a minute", () => {
      expect(formatSkip(5)).toBe("+5s");
      expect(formatSkip(-0.4)).toBe("−1s");
      expect(formatSkip(65)).toBe("+1:05");
      expect(formatSkip(-120)).toBe("−2:00");
   });
});

describe("volume steps", () => {
   it("steps by 5% and stops at the top", () => {
      expect(steppedVolume({ volume: 0.5, muted: false }, 1)).toEqual({ volume: 0.55, muted: false });
      expect(steppedVolume({ volume: 0.98, muted: false }, 1)).toEqual({ volume: 1, muted: false });
      expect(steppedVolume({ volume: 1, muted: false }, 1)).toBeNull();
   });
   it("mutes past the bottom and keeps the last level for the next step up", () => {
      expect(steppedVolume({ volume: 0.05, muted: false }, -1)).toEqual({ volume: 0.05, muted: true });
      expect(steppedVolume({ volume: 0.05, muted: true }, -1)).toBeNull();
      expect(steppedVolume({ volume: 0.05, muted: true }, 1)).toEqual({ volume: 0.05, muted: false });
   });
});
