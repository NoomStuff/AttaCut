import { describe, expect, it } from "vitest";
import { resolveFrameTime } from "./frames";
describe("source frame boundaries", () => {
   const points = [0, 0.04, 0.12, 0.13, 0.2];
   it("steps actual variable frame timestamps in both directions", () => {
      expect(resolveFrameTime(points, 0.04, 1, 1)).toBe(0.12);
      expect(resolveFrameTime(points, 0.12, 1, -1)).toBe(0.04);
      expect(resolveFrameTime(points, 0.09, 1, 1)).toBe(0.13);
   });
   it("uses the same nearest frame for cuts and stills while preserving the source endpoint", () => {
      expect(resolveFrameTime(points, 0.119, 1)).toBe(0.12);
      expect(resolveFrameTime(points, 1, 1)).toBe(1);
   });
});
