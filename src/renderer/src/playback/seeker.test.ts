import { expect, it, vi } from "vitest";
import { PlaybackClock } from "./clock";
import { PlaybackSeeker } from "./seeker";

it("keeps the cutoff position separate from the resolved and presented end frame", async () => {
   const clock = new PlaybackClock();
   const seeker = new PlaybackSeeker(clock);
   const video = Object.assign(new EventTarget(), { readyState: 1, seeking: false, currentTime: 0, pause: vi.fn() });
   seeker.attach(video as unknown as HTMLVideoElement);
   seeker.configure(async () => 1.9666666667);
   seeker.seek(2, false, false, -1);
   await new Promise((resolve) => setTimeout(resolve, 0));
   expect(clock.get()).toBe(2);
   expect(clock.getResolved()).toBe(1.9666666667);
   expect(clock.getDisplayed("source")).toBeNull();
   clock.displayFrame("source", 1.9666666667);
   expect(clock.getDisplayed("source")).toBe(1.9666666667);
   expect(clock.getDisplayed("replacement")).toBeNull();
   clock.set(3);
   expect(clock.getResolved()).toBeNull();
   seeker.configure(null);
   expect(clock.getDisplayed("source")).toBeNull();
});

it("keeps the new source's seek serialized when an old source finishes resolving", async () => {
   const seeker = new PlaybackSeeker(new PlaybackClock());
   const video = Object.assign(new EventTarget(), { readyState: 1, seeking: false, currentTime: 0, pause: vi.fn() });
   seeker.attach(video as unknown as HTMLVideoElement);
   let finishOld!: (time: number) => void;
   seeker.configure(
      () =>
         new Promise((resolve) => {
            finishOld = resolve;
         })
   );
   seeker.seek(1);

   let finishNew!: (time: number) => void;
   const resolveNew = vi.fn(
      () =>
         new Promise<number>((resolve) => {
            finishNew = resolve;
         })
   );
   seeker.configure(resolveNew);
   seeker.seek(2);
   seeker.seek(3);
   finishOld(1);
   await new Promise((resolve) => setTimeout(resolve, 0));
   expect(video.currentTime).toBe(0);
   expect(resolveNew).toHaveBeenCalledTimes(1);
   expect(seeker.getWaiting()).toBe(true);

   finishNew(2);
   await new Promise((resolve) => setTimeout(resolve, 0));
   expect(resolveNew).toHaveBeenCalledTimes(2);
   expect(resolveNew).toHaveBeenLastCalledWith(3, undefined);
   finishNew(3);
   await new Promise((resolve) => setTimeout(resolve, 0));
   expect(video.currentTime).toBeCloseTo(3, 5);
   expect(seeker.getWaiting()).toBe(false);
});
