import { describe, expect, it } from "vitest";
import { coverageChange, gapsBetween } from "./exportClips";

describe("export ranges", () => {
   it("lists the parts outside the clips, skipping slivers between touching clips", () => {
      const clips = [
         { id: "b", start: 4, end: 6, color: 1 },
         { id: "a", start: 1, end: 3.99, color: 0 },
         { id: "c", start: 8, end: 10, color: 2 },
      ];
      expect(gapsBetween(clips, 10, 0.02).map(({ start, end }) => [start, end])).toEqual([
         [0, 1],
         [6, 8],
      ]);
      expect(gapsBetween([], 5, 0.02)).toEqual([{ id: "gap:start:end", start: 0, end: 5, color: 0 }]);
      expect(gapsBetween([{ id: "a", start: 0, end: 5, color: 0 }], 5, 0.02)).toEqual([]);
   });
   it("handles overlapping clips without inventing a gap", () => {
      const clips = [
         { id: "a", start: 1, end: 5, color: 0 },
         { id: "b", start: 2, end: 3, color: 1 },
      ];
      expect(gapsBetween(clips, 6, 0.02).map(({ start, end }) => [start, end])).toEqual([
         [0, 1],
         [5, 6],
      ]);
   });
   it("measures what moving cuts to keyframes adds and drops", () => {
      expect(coverageChange([{ start: 1, end: 5 }], [{ start: 0.5, end: 4 }])).toEqual({ added: 0.5, dropped: 1 });
      expect(
         coverageChange(
            [
               { start: 0, end: 2 },
               { start: 2, end: 4 },
            ],
            [{ start: 0, end: 4 }]
         )
      ).toEqual({ added: 0, dropped: 0 });
      expect(coverageChange([{ start: 1, end: 2 }], [{ start: 3, end: 4 }])).toEqual({ added: 1, dropped: 1 });
   });
});
