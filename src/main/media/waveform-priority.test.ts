import { expect, it, vi } from "vitest";
import { WaveformPriority } from "./waveform-priority";
import type { WaveformRange } from "./waveform-decode";

it("coalesces viewport changes, skips covered ranges and never reads the whole overview", async () => {
   const priority = new WaveformPriority(7200, new AbortController().signal);
   const decode = vi.fn<(range: WaveformRange, signal: AbortSignal) => Promise<void>>(async () => {});
   priority.request(100, 120);
   priority.request(4000, 4020);
   await priority.read(10, decode);
   expect(decode).toHaveBeenCalledOnce();
   expect(decode.mock.calls[0]![0]).toEqual({ from: 4000, to: 4020 });
   priority.request(4005, 4010);
   priority.request(0, 7200);
   priority.request(100, 120);
   await priority.read(150, decode);
   expect(decode).toHaveBeenCalledOnce();
});

it("cancels an obsolete short read without cancelling the full scan", async () => {
   const controller = new AbortController();
   const priority = new WaveformPriority(7200, controller.signal);
   priority.request(100, 120);
   let reading!: AbortSignal;
   const first = priority.read(0, async (_range, signal) => {
      reading = signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      signal.throwIfAborted();
   });
   priority.request(4000, 4020);
   expect(reading.aborted).toBe(true);
   expect(controller.signal.aborted).toBe(false);
   await first;
   const second = vi.fn<(range: WaveformRange, signal: AbortSignal) => Promise<void>>(async () => {});
   await priority.read(0, second);
   expect(second.mock.calls[0]![0]).toEqual({ from: 4000, to: 4020 });
});

it("optional failures leave the scan usable but source cancellation still propagates", async () => {
   const controller = new AbortController();
   const priority = new WaveformPriority(7200, controller.signal);
   priority.request(100, 120);
   await priority.read(0, async () => {
      throw new Error("Unreadable region");
   });
   priority.request(200, 220);
   await expect(
      priority.read(0, async () => {
         controller.abort();
         controller.signal.throwIfAborted();
      })
   ).rejects.toThrow();
});
