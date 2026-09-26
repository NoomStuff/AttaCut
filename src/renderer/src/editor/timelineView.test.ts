import { expect, it } from "vitest";
import { visibleKeyframes, zoomLength } from "./timelineView";

it("keeps viewport endpoints and computes density from every visible point", () => {
   expect(visibleKeyframes([0, 1, 2, 3, 4], 1, 2, 12)).toEqual({ ticks: [1, 2, 3], opacity: 0.5 });
   expect(visibleKeyframes([0, 5], 1, 2, 12)).toEqual({ ticks: [], opacity: 1 });
});

it("bounds drawing work for a ten-hour all-intra recording", () => {
   const points = Array.from({ length: 2_160_000 }, (_, index) => index / 60);
   let reads = 0;
   const tracked = new Proxy(points, {
      get(target, key, receiver) {
         if (typeof key === "string" && /^\d+$/.test(key)) reads++;
         return Reflect.get(target, key, receiver);
      },
   });
   const view = visibleKeyframes(tracked, 0, 36000, 0.03);
   expect(view.ticks.length).toBeLessThanOrEqual(501);
   expect(view.opacity).toBe(0);
   expect(reads).toBeLessThan(30000);
});

it("zooms short videos without exceeding their duration", () => {
   expect(zoomLength(0.2, 0.2, 1)).toBe(0.2);
   expect(zoomLength(2, 10, 0)).toBe(10);
   expect(zoomLength(10, 10, 1)).toBe(8);
   expect(zoomLength(8, 10, -1)).toBe(10);
});
