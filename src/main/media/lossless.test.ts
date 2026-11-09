import { describe, expect, it } from "vitest";
import { isPacketSubsequence } from "./verify.ts";
import { cleanEnds } from "./cut.ts";

describe("lossless packet check", () => {
   it("accepts source packets in order with skipped ones and rejects anything changed or reordered", () => {
      const source = ["k1", "b1", "b2", "p1", "p2", "k2", "p3"];
      expect(isPacketSubsequence(["k1", "p1", "p2"], source)).toBe(true);
      expect(isPacketSubsequence(["k2", "p3"], source)).toBe(true);
      expect(isPacketSubsequence(["k1", "x", "p1"], source)).toBe(false);
      expect(isPacketSubsequence(["p1", "k1"], source)).toBe(false);
      expect(isPacketSubsequence(["p3", "p3"], source)).toBe(false);
   });
   it("stops a copy only where every kept frame decodes before every dropped one", () => {
      // I0 P3 B1 B2 P6 B4 B5 in decode order: a copy can end after I0 or after the B frames that P3 anchors.
      const reordered = [0, 3, 1, 2, 6, 4, 5].map((time, dts) => ({ time, dts }));
      expect(cleanEnds(reordered)).toEqual([1, 4]);
      const inOrder = [0, 1, 2, 3].map((time) => ({ time, dts: time }));
      expect(cleanEnds(inOrder)).toEqual([1, 2, 3]);
      // Packets without a decode time, as FFprobe reports at the start of a Matroska read, are skipped.
      expect(cleanEnds([{ time: 0, dts: Number.NaN }, ...inOrder.slice(1)])).toEqual([2, 3]);
   });
});
