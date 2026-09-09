import { expect, it } from "vitest";
import { adjacentBoundary, adjacentKeyframe, snapBoundary } from "./navigation";
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
