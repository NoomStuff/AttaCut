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
   it("matches a linear scan on every probe of a large index", () => {
      // A full MP4 frame index holds hundreds of thousands of times; the binary search must
      // agree with the original linear semantics for nearest, endpoints, and both directions.
      const frames = Array.from({ length: 400_000 }, (_, i) => i * (1 / 60) + (i % 7) * 1e-6);
      const linear = (time: number, direction: -1 | 0 | 1) => {
         const nearest = frames.reduce((best, point) => (Math.abs(point - time) < Math.abs(best - time) ? point : best));
         const current = Math.abs(time - frames.at(-1)!) < 0.0001 ? frames.at(-1)! : nearest;
         if (direction < 0) return frames.findLast((point) => point < current - 0.0001) ?? frames[0]!;
         if (direction > 0) return frames.find((point) => point > current + 0.0001) ?? frames.at(-1)!;
         if (time <= 0) return frames[0]!;
         if (Math.abs(time - frames.at(-1)!) < 0.0001) return frames.at(-1)!;
         return nearest;
      };
      for (let i = 0; i < 200; i++) {
         const time = Math.random() * frames.at(-1)!;
         expect(resolveFrameTime(frames, time, frames.at(-1)!)).toBe(linear(time, 0));
         expect(resolveFrameTime(frames, time, frames.at(-1)!, 1)).toBe(linear(time, 1));
         expect(resolveFrameTime(frames, time, frames.at(-1)!, -1)).toBe(linear(time, -1));
      }
      // Exact hits, ties, and the timeline ends.
      expect(resolveFrameTime(frames, 0, frames.at(-1)!)).toBe(0);
      expect(resolveFrameTime(frames, frames[3]!, frames.at(-1)!)).toBe(frames[3]);
      expect(resolveFrameTime(frames, frames.at(-1)!, frames.at(-1)!, -1)).toBe(frames[frames.length - 2]);
      expect(resolveFrameTime(frames, frames.at(-1)!, frames.at(-1)!, 1)).toBe(frames.at(-1));
   });
});
