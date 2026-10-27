import { expect, it } from "vitest";
import { frameTimesRequestSchema } from "./media-requests";
import { clipLimit } from "./defaults";

it("bounds frame batches and rejects nonfinite or negative timestamps at the IPC boundary", () => {
   const parse = (times: number[]) => frameTimesRequestSchema.safeParse({ sourceId: "source", times }).success;
   expect(parse(Array.from({ length: clipLimit * 2 }, (_, index) => index / 30))).toBe(true);
   expect(parse(Array(clipLimit * 2 + 1).fill(0))).toBe(false);
   for (const value of [NaN, Infinity, -1]) expect(parse([value])).toBe(false);
});
