import { expect, it } from "vitest";
import { TimelineMotion } from "./timelineMotion";
import { constrainViewStart } from "../editor/timelineView";

const unchanged = <T>(value: T): T => value;

it("keeps the source under the zoom anchor fixed throughout both coordinates", () => {
   const motion = new TimelineMotion({ start: 10, length: 2 });
   const fraction = 0.95;
   const focus = 10 + fraction * 2;
   motion.retarget({ start: focus - fraction * 4, length: 4 }, 0, true);
   for (const time of [0, 16, 80, 120, 200, 240]) {
      const view = motion.frame(time, unchanged);
      expect(view.start + fraction * view.length).toBeCloseTo(focus, 12);
   }
   expect(motion.active).toBe(false);
});

it("finishes position and width together despite repeated playback pans", () => {
   const motion = new TimelineMotion({ start: 8, length: 2 });
   motion.retarget({ start: 6, length: 4 }, 0, true);
   motion.frame(80, unchanged);
   motion.retarget({ start: 6.1, length: 4 }, 80, true);
   motion.frame(160, unchanged);
   motion.retarget({ start: 6.2, length: 4 }, 160, true);
   expect(motion.frame(240, unchanged)).toEqual({ start: 6.2, length: 4 });
   expect(motion.active).toBe(false);
   motion.retarget({ start: 6.22, length: 4 }, 260, true);
   expect(motion.value).toEqual({ start: 6.22, length: 4 });
});

it("retargets from the bounded visible range rather than a hidden position", () => {
   const motion = new TimelineMotion({ start: 0, length: 2 });
   motion.frame(0, (view) => ({ ...view, start: constrainViewStart(view.start, view.length, 18, 9) }));
   expect(motion.value.start).toBe(7.2);
   const visible = motion.value;
   motion.retarget({ start: 6.25, length: 4 }, 10, true);
   expect(motion.frame(10, unchanged)).toEqual(visible);
   motion.frame(90, unchanged);
   const intermediate = motion.value;
   motion.retarget({ start: 5, length: 6 }, 90, true);
   expect(motion.frame(90, unchanged)).toEqual(intermediate);
});

it("tweens paused navigation and immediately hands control to a pointer pan", () => {
   const motion = new TimelineMotion({ start: 2, length: 2 });
   motion.retarget({ start: 6, length: 2 }, 0, false);
   expect(motion.frame(120, unchanged).start).toBeGreaterThan(2);
   expect(motion.value.start).toBeLessThan(6);
   motion.retarget({ start: 3, length: 2 }, 130, false, true);
   expect(motion.value).toEqual({ start: 3, length: 2 });
   expect(motion.active).toBe(false);
});
