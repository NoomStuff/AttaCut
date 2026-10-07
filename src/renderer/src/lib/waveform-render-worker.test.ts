import { expect, it, vi } from "vitest";
import type { WaveformMessage } from "./waveform-renderer";

it("reveals a distant priority region without drawing unknown audio and removes its final fade", async () => {
   vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
   const fills: number[][][] = [];
   const fades: number[] = [];
   vi.stubGlobal(
      "Path2D",
      class {
         rectangles: number[][] = [];
         rect(...values: number[]) {
            this.rectangles.push(values);
         }
      }
   );
   const context = {
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fill: (path: { rectangles: number[][] }) => {
         fills.push(path.rectangles);
      },
      fillRect: () => {
         fades.push(performance.now());
      },
      fillStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
   };
   const canvas = { width: 0, height: 0, getContext: () => context } as unknown as OffscreenCanvas;
   try {
      await import("./waveform-render-worker");
      const send = (data: WaveformMessage) => (globalThis as unknown as { onmessage: (event: { data: WaveformMessage }) => void }).onmessage({ data });
      send({ type: "init", duration: 100 });
      const view = { width: 200, height: 20, bands: [{ from: 50, to: 60, left: 0, width: 200, color: "white", fadeSeconds: 1.6 }] };
      send({ type: "attach", id: 1, canvas, view });
      vi.advanceTimersByTime(33);
      expect(fills).toHaveLength(0);
      send({ type: "peaks", offset: 50000, peaks: new Uint8Array(30000).fill(128), priority: true });
      vi.advanceTimersByTime(300);
      expect(fills.at(-1)!.some((rect) => rect[0] === 199)).toBe(true);
      expect(fades.length).toBeGreaterThan(0);
      expect(fades.every((time) => time < 33 + 240)).toBe(true);
      const before = fills.length;
      send({ type: "view", id: 1, view: { ...view, bands: [{ ...view.bands[0]!, from: 0, to: 10 }] } });
      vi.advanceTimersByTime(33);
      expect(fills).toHaveLength(before);
      send({ type: "remove", id: 1 });
   } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
   }
});
