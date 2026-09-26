import { expect, it } from "vitest";
import { adjacentBoundary, adjacentKeyframe, clipFloor, neighboringKeyframe, resolveBoundary, snapBoundary, splitTargetAt, stepBoundary } from "./navigation";
const clips = [
   { id: "a", start: 1, end: 4, color: 0 },
   { id: "b", start: 7, end: 10, color: 1 },
];
it("navigates starts and ends in both directions, including gaps", () => {
   expect(adjacentBoundary(clips, 2, -1)).toBe(1);
   expect(adjacentBoundary(clips, 2, 1)).toBe(4);
   expect(adjacentBoundary(clips, 4, 1)).toBe(7);
   expect(adjacentBoundary(clips, 7, -1)).toBe(4);
   expect(adjacentBoundary(clips, 5, 1)).toBe(7);
   expect(adjacentBoundary(clips, 1, -1)).toBeNull();
   expect(adjacentBoundary(clips, 10, 1)).toBeNull();
});
it("snaps to valid keys without crossing neighboring clips", () => {
   const document = { clips, selectedId: "b" };
   expect(snapBoundary(document, "b", "start", 3.6, [0, 2, 6, 8, 10], 12)).toBe(6);
   expect(snapBoundary(document, "a", "end", 6.7, [0, 2, 6, 8, 10], 12)).toBe(6);
   expect(snapBoundary(document, "a", "end", 3, [0], 12)).toBe(4);
});
it("steps to the next and previous keyframe, including the timeline ends", () => {
   expect(adjacentKeyframe(3, 1, [2, 6, 8], 12)).toBe(6);
   expect(adjacentKeyframe(3, -1, [2, 6, 8], 12)).toBe(2);
   expect(adjacentKeyframe(9, 1, [2, 6, 8], 12)).toBe(12);
   expect(adjacentKeyframe(1, -1, [2, 6, 8], 12)).toBe(0);
   expect(adjacentKeyframe(12, 1, [2, 6, 8], 12)).toBe(12);
});
it("resolves boundary edits to a snapped, floored time", () => {
   const document = { clips, selectedId: "b" };
   const drag = { duration: 12, viewLength: 12, frameStep: 0.01 };
   expect(resolveBoundary(document, "b", "start", 6.5, { ...drag, snapping: true, keyframes: [2, 6] })).toBe(6);
   expect(resolveBoundary(document, "a", "end", 6.7, { ...drag, snapping: true, keyframes: [0, 2, 6, 8, 10] })).toBe(6);
   expect(resolveBoundary(document, "b", "start", 9.9, { ...drag, snapping: false })).toBeCloseTo(9.82);
   expect(resolveBoundary(document, "b", "end", 7.05, { ...drag, snapping: false })).toBeCloseTo(7.18);
});
it("floors boundaries without expanding already shorter clips", () => {
   const document = { clips: [{ id: "s", start: 5, end: 5.1, color: 0 }], selectedId: "s" };
   const drag = { duration: 12, viewLength: 12, frameStep: 0.01 };
   expect(clipFloor(document, "s", 12, 0.01)).toBeCloseTo(0.1);
   expect(resolveBoundary(document, "s", "end", 5.05, { ...drag, snapping: false })).toBeCloseTo(5.1);
});
it("picks the nearest keyframe inside the clip for a split, or disables it", () => {
   const document = { clips: [{ id: "a", start: 2, end: 10, color: 0 }], selectedId: "a" };
   expect(splitTargetAt(document, "a", 5, { snapping: false, keyframes: [3, 6] })).toBe(5);
   expect(splitTargetAt(document, "a", 5, { snapping: true, keyframes: [3, 6, 11] })).toBe(6);
   expect(splitTargetAt(document, "a", 5, { snapping: true, keyframes: [11] })).toBe(Infinity);
   expect(splitTargetAt(document, "missing", 5, { snapping: true, keyframes: [6] })).toBe(5);
});
it("steps keyboard boundaries by keyframe or frame without violating floors", () => {
   const document = { clips: [{ id: "b", start: 7, end: 10, color: 1 }], selectedId: "b" };
   const options = { duration: 12, viewLength: 12, frameStep: 0.5, snapping: true, keyframes: [6, 8, 9.5] };
   expect(stepBoundary(document, "b", "start", 1, options)).toBe(8);
   expect(stepBoundary(document, "b", "end", -1, options)).toBe(9.5);
   // Stepping the start leftward extends the clip into the gap; the keyframe at 6 is legal.
   expect(stepBoundary(document, "b", "start", -1, options)).toBe(6);
   const free = { ...options, snapping: false };
   expect(stepBoundary(document, "b", "start", 1, free)).toBe(7.5);
   expect(stepBoundary(document, "b", "start", 1, { ...free, step: 1 })).toBe(8);
   // A large step cannot cross the two-frame minimum-length floor.
   expect(stepBoundary(document, "b", "end", -1, { ...free, step: 3 })).toBe(8);
});
it("snaps and steps identically on a large keyframe index", () => {
   // All-intra multi-hour recordings hold hundreds of thousands of keys; the binary search
   // must agree with a linear scan at every probe position.
   const keys = Array.from({ length: 200_000 }, (_, i) => i * 0.05); // 0 .. 9999.95
   const document = { clips: [{ id: "a", start: 100, end: 9900, color: 0 }], selectedId: "a" };
   for (const value of [0, 99.999, 100, 5000, 5000.02, 9900, 10000]) {
      const linear = [...keys]
         .filter((point) => point >= 100 && point <= 9900)
         .reduce((best, point) => (Math.abs(point - value) < Math.abs(best - value) ? point : best), Infinity);
      expect(splitTargetAt(document, "a", value, { snapping: true, keyframes: keys })).toBe(linear);
   }
   expect(adjacentKeyframe(5000.021, 1, keys, 10000)).toBe(5000.05);
   expect(adjacentKeyframe(5000.021, -1, keys, 10000)).toBe(5000);
   expect(adjacentKeyframe(9999.96, 1, keys, 10000)).toBe(10000);
   expect(neighboringKeyframe(5000, -1, keys)).toBe(keys[99_999]);
   expect(neighboringKeyframe(5000, 1, keys)).toBe(keys[100_001]);
   expect(neighboringKeyframe(-1, -1, keys)).toBeNull();
   expect(neighboringKeyframe(10000, 1, keys)).toBeNull();
});
