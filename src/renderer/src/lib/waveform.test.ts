import { expect, it, vi } from "vitest";
import { drawWaveformDataBand as drawWaveformBand, fillWaveformData as fillWaveform } from "./waveform-data";
import { waveformLevels, waveformResolution } from "../../../shared/media";
import type { WaveformData as Waveform } from "./waveform-data";

it("bounds long recording memory and folds chunks that split coarse buckets", () => {
   expect(waveformResolution(7200)).toBe(1000);
   expect(waveformResolution(86400)).toBe(10);
   expect(waveformResolution(8_000_001)).toBe(0);
   const levels = waveformLevels.map((rate) => ({ rate, down: new Uint8Array(rate), up: new Uint8Array(rate), rms: new Uint8Array(rate) }));
   fillWaveform(levels, 0, new Uint8Array([20, 30, 10, 40, 50, 20]));
   fillWaveform(levels, 2, new Uint8Array([60, 70, 30]));
   expect(levels[1]!.down[0]).toBe(60);
   expect(levels[1]!.up[0]).toBe(70);
   expect(levels[3]!.up[0]).toBe(70);
});

it("uses fine detail at deep zoom and removes the decode fade after completion", () => {
   const rectangles: number[][] = [];
   vi.stubGlobal(
      "Path2D",
      class {
         rect(...args: number[]) {
            rectangles.push(args);
         }
      }
   );
   const fillRect = vi.fn();
   const context = {
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect,
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
   } as unknown as CanvasRenderingContext2D;
   const wave: Waveform = {
      filled: 1,
      levels: [
         { rate: 1000, down: new Uint8Array([0, 128]), up: new Uint8Array([128, 0]), rms: new Uint8Array([60, 60]) },
         { rate: 1, down: new Uint8Array([255]), up: new Uint8Array([255]), rms: new Uint8Array([255]) },
      ],
   };
   drawWaveformBand({ context, waveform: wave, from: 0, to: 0.002, width: 10, height: 20, color: "white", revealedSeconds: 0.002, fadeSeconds: 0.001 });
   expect(rectangles.some((rect) => rect[3]! < 20)).toBe(true);
   expect(rectangles.every((rect) => rect[3]! < 20)).toBe(true);
   expect(fillRect).not.toHaveBeenCalled();
   vi.unstubAllGlobals();
});
it("preserves the audio energy when folding square-root-scaled RMS", () => {
   const levels = [
      { rate: 1000, down: new Uint8Array(10), up: new Uint8Array(10), rms: new Uint8Array(10) },
      { rate: 100, down: new Uint8Array(1), up: new Uint8Array(1), rms: new Uint8Array(1) },
   ];
   fillWaveform(levels, 0, new Uint8Array([0, 255, 255]));
   // One loud millisecond followed by nine silent milliseconds has RMS 1/sqrt(10).
   expect(levels[1]!.rms[0]).toBe(Math.round(255 * Math.sqrt(1 / Math.sqrt(10))));
});

it("fully erases the loading frontier and leaves revealed clip edges unfaded", () => {
   vi.stubGlobal(
      "Path2D",
      class {
         rect() {}
      }
   );
   const erased: { alpha: number; operation: string }[] = [];
   const context = {
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: () => erased.push({ alpha: context.globalAlpha, operation: context.globalCompositeOperation }),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
   };
   const wave: Waveform = {
      filled: 0.5,
      levels: [{ rate: 1, down: new Uint8Array(100).fill(128), up: new Uint8Array(100).fill(128), rms: new Uint8Array(100).fill(64) }],
   };
   const draw = (from: number, to: number, revealedSeconds: number) =>
      drawWaveformBand({
         context: context as unknown as CanvasRenderingContext2D,
         waveform: wave,
         from,
         to,
         width: 200,
         height: 20,
         color: "white",
         revealedSeconds,
         fadeSeconds: 8,
         alpha: 0.55,
      });
   try {
      draw(0, 100, 50);
      expect(erased).toEqual([{ alpha: 1, operation: "destination-out" }]);
      erased.length = 0;
      // A clip and a panned viewport can end before the full source has loaded.
      draw(0, 40, 50);
      draw(20, 40, 50);
      draw(0, 50, 50);
      draw(0, 100, 100);
      expect(erased).toHaveLength(0);
   } finally {
      vi.unstubAllGlobals();
   }
});

it("preserves RMS energy when a pixel spans loud and silent buckets", () => {
   const rectangles: number[][] = [];
   vi.stubGlobal(
      "Path2D",
      class {
         rect(...args: number[]) {
            rectangles.push(args);
         }
      }
   );
   const context = {
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillStyle: "",
      globalAlpha: 1,
   } as unknown as CanvasRenderingContext2D;
   const wave: Waveform = {
      filled: 1,
      levels: [{ rate: 1000, down: new Uint8Array(10), up: new Uint8Array(10), rms: new Uint8Array([255, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }],
   };
   try {
      drawWaveformBand({ context, waveform: wave, from: 0, to: 0.01, width: 1, height: 20, color: "white", revealedSeconds: 0.01, fadeSeconds: 0 });
      expect(rectangles).toHaveLength(1);
      expect(rectangles[0]![3]).toBeCloseTo((Math.round(255 * Math.sqrt(1 / Math.sqrt(10))) / 255) * 20);
   } finally {
      vi.unstubAllGlobals();
   }
});
