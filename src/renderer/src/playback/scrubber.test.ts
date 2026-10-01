import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioScrubber } from "./scrubber";
import type { ScrubAudio } from "../../../shared/types";
afterEach(() => {
   vi.unstubAllGlobals();
   vi.useRealTimers();
});

function audioHarness() {
   vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
   vi.stubGlobal("window", { clearTimeout, setTimeout });
   const voices: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
   const ramps: ReturnType<typeof vi.fn>[] = [];
   vi.stubGlobal(
      "AudioContext",
      class {
         state = "running";
         get currentTime() {
            return performance.now() / 1000;
         }
         createBuffer = (_channels: number, frames: number, rate: number) => ({
            sampleRate: rate,
            duration: frames / rate,
            getChannelData: () => new Float32Array(frames),
         });
         createBufferSource = () => {
            const voice = { connect: () => ({ connect: () => {} }), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null };
            voices.push(voice);
            return voice;
         };
         createGain = () => {
            const ramp = vi.fn();
            ramps.push(ramp);
            return { gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: ramp }, disconnect: vi.fn() };
         };
         close = async () => {};
      }
   );
   const scrubber = new AudioScrubber();
   return { scrubber, voices, ramps };
}

describe("scrub auditions", () => {
   it("does not replay a snapped position, including timestamp rounding noise", () => {
      const { scrubber, voices } = audioHarness();
      scrubber.setPcm(new ArrayBuffer(22050 * 2 * 10), 22050);
      scrubber.scrub(2, 0.7);
      for (let i = 0; i < 100; i++) {
         vi.advanceTimersByTime(25);
         scrubber.scrub(2 + 0.000000001, 0.7);
      }
      expect(voices).toHaveLength(1);
      scrubber.scrub(4, 0.7);
      expect(voices).toHaveLength(2);
      scrubber.dispose();
   });

   it("auditions the latest fast movement and cancels queued audio when playback takes over", () => {
      const { scrubber, voices, ramps } = audioHarness();
      scrubber.setPcm(new ArrayBuffer(22050 * 2 * 10), 22050);
      scrubber.scrub(1, 0.7);
      vi.advanceTimersByTime(20);
      scrubber.scrub(2, 0.7);
      vi.advanceTimersByTime(10);
      scrubber.scrub(3, 0.7);
      vi.advanceTimersByTime(20);
      expect(voices).toHaveLength(2);
      expect(voices[1]!.start).toHaveBeenCalledWith(0.05, 3, 0.16);
      expect(ramps[0]).toHaveBeenLastCalledWith(0, 0.058);
      scrubber.scrub(4, 0.7);
      scrubber.stop();
      vi.advanceTimersByTime(100);
      expect(voices).toHaveLength(2);
      scrubber.scrub(3, 0.7);
      expect(voices).toHaveLength(3);
      scrubber.dispose();
   });

   it("drops an obsolete queued position when the pointer returns to the playing sample", () => {
      const { scrubber, voices } = audioHarness();
      scrubber.setPcm(new ArrayBuffer(22050 * 2 * 10), 22050);
      scrubber.scrub(2, 1);
      vi.advanceTimersByTime(10);
      scrubber.scrub(3, 1);
      scrubber.scrub(2, 1);
      vi.advanceTimersByTime(100);
      expect(voices).toHaveLength(1);
      scrubber.dispose();
   });

   it("auditions before an end cut, with a short attack and no audio beyond that cut", () => {
      const { scrubber, voices, ramps } = audioHarness();
      scrubber.setPcm(new ArrayBuffer(22050 * 2 * 31), 22050);
      scrubber.scrub(30, 0.7, "end");
      const [, offset, duration] = voices[0]!.start.mock.calls[0]!;
      expect(offset).toBeCloseTo(29.84);
      expect(offset + duration).toBeCloseTo(30);
      expect(ramps[0]).toHaveBeenCalledWith(0.7, 0.005);
      expect(ramps[0]).toHaveBeenLastCalledWith(0, duration);
      scrubber.dispose();
   });

   it("plays the latest cold seek once loaded, and never plays it after Stop", async () => {
      const { scrubber, voices } = audioHarness();
      const loads = new Map<number, (data: ScrubAudio) => void>();
      scrubber.configure((start) => new Promise((resolve) => loads.set(start, resolve)));
      scrubber.scrub(62, 1);
      scrubber.scrub(63, 1);
      loads.get(60)!({ start: 60, sampleRate: 22050, pcm: new ArrayBuffer(22050 * 2 * 30) });
      await Promise.resolve();
      expect(voices).toHaveLength(1);
      expect(voices[0]!.start).toHaveBeenCalledWith(0, 3, 0.16);
      scrubber.scrub(93, 1);
      scrubber.stop();
      loads.get(90)!({ start: 90, sampleRate: 22050, pcm: new ArrayBuffer(22050 * 2 * 30) });
      await Promise.resolve();
      expect(voices).toHaveLength(1);
      scrubber.dispose();
   });
});
describe("scrub audio ownership", () => {
   it("drops already decoded audio when the new selection fails or is silent", async () => {
      vi.stubGlobal("window", { clearTimeout, setTimeout });
      const stop = vi.fn();
      const createVoice = vi.fn(() => ({ connect: () => ({ connect: () => {} }), start: vi.fn(), stop, onended: null }));
      const close = vi.fn(async () => {});
      vi.stubGlobal(
         "AudioContext",
         class {
            state = "running";
            currentTime = 0;
            createBuffer = (_channels: number, frames: number, rate: number) => ({ duration: frames / rate, getChannelData: () => new Float32Array(frames) });
            createBufferSource = createVoice;
            createGain = () => ({ gain: { value: 1, cancelScheduledValues: () => {}, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} } });
            close = close;
         }
      );
      const scrubber = new AudioScrubber();
      scrubber.configure(async () => ({ start: 0, sampleRate: 22050, pcm: new ArrayBuffer(44100) }));
      await Promise.resolve();
      scrubber.scrub(0.2, 1);
      expect(createVoice).toHaveBeenCalledTimes(1);
      scrubber.configure(async () => {
         throw new Error("new extraction failed");
      });
      await Promise.resolve();
      await Promise.resolve();
      scrubber.scrub(0.2, 1);
      scrubber.configure(null);
      scrubber.scrub(0.2, 1);
      expect(stop).toHaveBeenCalledOnce();
      expect(createVoice).toHaveBeenCalledTimes(1);
      scrubber.dispose();
      expect(close).toHaveBeenCalledOnce();
   });
   it("discards pending audio when switching to a silent source", async () => {
      vi.stubGlobal("window", { clearTimeout, setTimeout });
      const scrubber = new AudioScrubber();
      const set = vi.spyOn(scrubber, "setPcm");
      let finish!: (data: ScrubAudio) => void;
      scrubber.configure(
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      scrubber.configure(null);
      finish({ start: 0, sampleRate: 22050, pcm: new ArrayBuffer(100) });
      await Promise.resolve();
      expect(set).not.toHaveBeenCalled();
   });
   it("ignores a failed old selection while loading the current selection", async () => {
      vi.stubGlobal("window", { clearTimeout, setTimeout });
      const scrubber = new AudioScrubber();
      let fail!: (error: Error) => void;
      scrubber.configure(
         () =>
            new Promise((_resolve, reject) => {
               fail = reject;
            })
      );
      const load = vi.fn(async () => null);
      scrubber.configure(load);
      fail(new Error("old selection failed"));
      await Promise.resolve();
      await Promise.resolve();
      scrubber.scrub(90, 1);
      expect(load).toHaveBeenLastCalledWith(90);
      scrubber.dispose();
   });
});
