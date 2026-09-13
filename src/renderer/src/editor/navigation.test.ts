import { expect, it } from "vitest";
import { adjacentBoundary, adjacentKeyframe, clipFloor, resolveBoundary, snapBoundary } from "./navigation";
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
