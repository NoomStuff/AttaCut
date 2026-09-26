import { expect, it, vi } from "vitest";
import { PlaybackClock } from "./clock";
import { PlaybackSeeker } from "./seeker";

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
   expect(resolveNew).toHaveBeenLastCalledWith(3);
   finishNew(3);
   await new Promise((resolve) => setTimeout(resolve, 0));
   expect(video.currentTime).toBe(3);
   expect(seeker.getWaiting()).toBe(false);
});
