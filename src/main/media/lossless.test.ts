import { describe, expect, it } from "vitest";
import { isPacketSubsequence } from "./verify.ts";

describe("lossless packet check", () => {
   it("accepts source packets in order with skipped ones and rejects anything changed or reordered", () => {
      const source = ["k1", "b1", "b2", "p1", "p2", "k2", "p3"];
      expect(isPacketSubsequence(["k1", "p1", "p2"], source)).toBe(true);
      expect(isPacketSubsequence(["k2", "p3"], source)).toBe(true);
      expect(isPacketSubsequence(["k1", "x", "p1"], source)).toBe(false);
      expect(isPacketSubsequence(["p1", "k1"], source)).toBe(false);
      expect(isPacketSubsequence(["p3", "p3"], source)).toBe(false);
   });
});
