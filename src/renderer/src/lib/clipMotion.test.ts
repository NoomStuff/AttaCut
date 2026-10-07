import { expect, it } from "vitest";
import { ClipMotion } from "./clipMotion";

const clips = [{ id: "clip", start: 0, end: 18, color: 0 }];

it("animates both trimmed edges while keeping waveform source coordinates", () => {
   const motion = new ClipMotion(clips);
   motion.retarget([{ ...clips[0]!, start: 3, end: 12 }], 0, true);
   const middle = motion.frame(85)[0]!;
   expect(middle.start).toBeCloseTo(2.625);
   expect(middle.end).toBeCloseTo(12.75);
   expect(motion.frame(170)[0]).toEqual({ ...clips[0], start: 3, end: 12 });
   expect(motion.active).toBe(false);
});

it("retargets a rapid trim from the visible edges and snaps topology changes", () => {
   const motion = new ClipMotion(clips);
   motion.retarget([{ ...clips[0]!, start: 3 }], 0, true);
   const visible = motion.frame(50);
   motion.retarget([{ ...clips[0]!, start: 6 }], 50, true);
   expect(motion.frame(50)).toEqual(visible);
   const split = [
      { ...clips[0]!, end: 9 },
      { id: "other", start: 9, end: 18, color: 1 },
   ];
   motion.retarget(split, 60, true);
   expect(motion.value).toBe(split);
   expect(motion.active).toBe(false);
});

it("keeps pointer trims and reduced motion immediate", () => {
   const motion = new ClipMotion(clips);
   const trimmed = [{ ...clips[0]!, start: 4 }];
   motion.retarget(trimmed, 0, false);
   expect(motion.value).toBe(trimmed);
   expect(motion.active).toBe(false);
});
