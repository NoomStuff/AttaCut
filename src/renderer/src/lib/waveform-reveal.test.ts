import { expect, it } from "vitest";
import { WaveformReveal } from "./waveform-reveal";

it("animates small progress on a long recording without snapping", () => {
   const reveal = new WaveformReveal();
   reveal.retarget(0.25, 1000);
   expect(reveal.frame(1000)).toEqual({ seconds: 0, active: true });
   expect(reveal.frame(1120).seconds).toBeGreaterThan(0);
   expect(reveal.frame(1120).seconds).toBeLessThan(0.25);
   expect(reveal.frame(1240)).toEqual({ seconds: 0.25, active: false });
   expect(reveal.frame(1000, true)).toEqual({ seconds: 0.25, active: false });
});

it("preserves continuity across chunks and finishes a complete cached reveal in bounded time", () => {
   const reveal = new WaveformReveal();
   reveal.retarget(10, 0);
   const before = reveal.frame(100).seconds;
   reveal.retarget(7200, 100);
   expect(reveal.frame(100).seconds).toBe(before);
   expect(reveal.frame(220).seconds).toBeLessThan(7200);
   expect(reveal.frame(340)).toEqual({ seconds: 7200, active: false });
   reveal.retarget(10, 400);
   expect(reveal.frame(400)).toEqual({ seconds: 7200, active: false });
});
