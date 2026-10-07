import { expect, it } from "vitest";
import { WaveformGate } from "./waveform-gate";

it("resumes all waiting PCM and cache consumers", async () => {
   const gate = new WaveformGate();
   const first = gate.wait();
   const second = gate.wait();
   gate.resume();
   await Promise.all([first, second]);
   await gate.wait();
});

it("keeps consumers paused when new activity interrupts a resume", async () => {
   const gate = new WaveformGate();
   let completed = 0;
   const waits = [gate.wait().then(() => completed++), gate.wait().then(() => completed++)];
   gate.resume();
   gate.pause();
   await Promise.resolve();
   await Promise.resolve();
   expect(completed).toBe(0);
   gate.resume();
   await Promise.all(waits);
   expect(completed).toBe(2);
});

it("releases cancellation even if an old pause arrives afterwards", async () => {
   const gate = new WaveformGate();
   const pending = gate.wait();
   gate.close();
   gate.pause();
   await pending;
   await gate.wait();
});
