import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioScrubber } from "./scrubber";
import type { ScrubAudio } from "../../../shared/types";
afterEach(() => vi.unstubAllGlobals());
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
            createGain = () => ({ gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} } });
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
