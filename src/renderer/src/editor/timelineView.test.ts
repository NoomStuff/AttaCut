import { expect, it } from "vitest";
import { constrainViewStart, frameLevelActive, quantizeToFrame, visibleKeyframes, zoomLength } from "./timelineView";

it("constrains pointer-centered zooms to playback margins before and during the tween", () => {
   expect(constrainViewStart(1, 4, 18, 8)).toBeCloseTo(4.4);
   expect(constrainViewStart(10, 4, 18, 8)).toBeCloseTo(7.6);
   expect(constrainViewStart(6, 4, 18, 8)).toBe(6);
   expect(constrainViewStart(6, 16, 18, 17)).toBe(2);
   expect(constrainViewStart(-5, 4, 18, 0)).toBe(0);
   expect(constrainViewStart(20, 18, 18, 8)).toBe(0);
   // Paused zooms can use the full recording without following the playhead.
   expect(constrainViewStart(1, 4, 18)).toBe(1);
});

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

it("enables frame-level editing once few frames fit the view", () => {
   const frame = 1 / 30;
   expect(frameLevelActive(80 * frame, frame)).toBe(true);
   expect(frameLevelActive(80 * frame + frame / 2, frame)).toBe(false);
   // An 18-second 30fps recording at fit shows all 540 frames: ordinary editing.
   expect(frameLevelActive(18, frame)).toBe(false);
   expect(frameLevelActive(18, 0)).toBe(false);
});

it("quantizes picks onto the frame grid without leaving the timeline", () => {
   const frame = 1 / 30;
   expect(quantizeToFrame(7.38, frame, 0, 18)).toBeCloseTo(221 * frame, 12);
   expect(quantizeToFrame(0.507, frame, 0, 18)).toBeCloseTo(0.5, 12);
   expect(quantizeToFrame(17.999, frame, 0, 18)).toBe(18);
   expect(quantizeToFrame(-0.2, frame, 0, 18)).toBe(0);
});
