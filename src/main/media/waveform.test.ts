import { describe, expect, it, vi } from "vitest";
import { WaveformEncoder, extractWaveform } from "./waveform";
import { waveformRate, waveformSampleRate } from "../../shared/media";
import { runMedia } from "./process";
import type { ProbedSource } from "./probe";

vi.mock("./process", () => ({ runMedia: vi.fn(async () => "") }));

function pcm(values: number[]): Uint8Array {
   const bytes = new Uint8Array(values.length * 2);
   const view = new DataView(bytes.buffer);
   values.forEach((value, index) => view.setInt16(index * 2, value, true));
   return bytes;
}
const scale = (amplitude: number) => Math.round(Math.sqrt(amplitude / 32768) * 255);

describe("waveform encoding", () => {
   it("keeps the min, max, and RMS of each bucket as an interleaved triple", () => {
      const encoder = new WaveformEncoder();
      const samples = new Array(16).fill(0);
      samples[3] = -24000;
      samples[10] = 12000;
      encoder.push(pcm(samples));
      encoder.finish();
      const { peaks } = encoder.take();
      expect(peaks).toHaveLength(3);
      expect(peaks[0]).toBe(scale(24000));
      expect(peaks[1]).toBe(scale(12000));
      const rootMeanSquare = Math.sqrt((24000 ** 2 + 12000 ** 2) / 16);
      expect(peaks[2]).toBe(scale(rootMeanSquare));
   });

   it("folds sixteen samples per millisecond bucket at the documented rates", () => {
      expect(waveformSampleRate / waveformRate).toBe(16);
   });

   it("reassembles samples split across chunk boundaries", () => {
      const whole = new WaveformEncoder();
      const split = new WaveformEncoder();
      const samples = new Array(32).fill(0);
      samples[5] = -20000;
      samples[20] = 9000;
      const bytes = pcm(samples);
      whole.push(bytes);
      whole.finish();
      for (let index = 0; index < bytes.length; index++) split.push(bytes.subarray(index, index + 1));
      split.finish();
      expect(split.take()).toEqual(whole.take());
   });

   it("flushes a trailing partial bucket over the samples it received", () => {
      const encoder = new WaveformEncoder();
      encoder.push(pcm([100, -200, 300]));
      encoder.finish();
      const rootMeanSquare = Math.sqrt((100 ** 2 + 200 ** 2 + 300 ** 2) / 3);
      expect(encoder.take().peaks).toEqual(new Uint8Array([scale(200), scale(300), scale(rootMeanSquare)]));
   });

   it("treats silence as a flat line", () => {
      const encoder = new WaveformEncoder();
      encoder.push(pcm(new Array(16).fill(0)));
      encoder.finish();
      expect(encoder.take().peaks).toEqual(new Uint8Array([0, 0, 0]));
   });
});

describe("waveform extraction", () => {
   it("rejects requests naming no audio stream of the source", async () => {
      const source = { path: "recording.mkv", streams: [{ type: "video", index: 0 }] } as unknown as ProbedSource;
      await expect(extractWaveform(source, [1], undefined)).resolves.toBeNull();
   });

   it("streams chunks while decoding and resolves the complete peaks", async () => {
      const whole = 10 * waveformSampleRate;
      const remainder = Math.round(0.5 * waveformSampleRate);
      const wave = (count: number) => {
         const buffer = new Uint8Array(count * 2);
         const view = new DataView(buffer.buffer);
         for (let index = 0; index < count; index++) view.setInt16(index * 2, (index % 16) * 100, true);
         return buffer;
      };
      vi.mocked(runMedia).mockImplementationOnce(async (_name, _args, options) => {
         options?.onBytes?.(Buffer.from(wave(whole)));
         options?.onBytes?.(Buffer.from(wave(remainder)));
         return "";
      });
      const chunks: { offset: number; peaks: Uint8Array }[] = [];
      const source = { path: "recording.mkv", duration: 10.5, streams: [{ type: "audio", index: 1 }] } as unknown as ProbedSource;
      const result = await extractWaveform(source, [1], undefined, (chunk) => chunks.push(chunk));
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({ offset: 0 });
      expect(chunks[0]!.peaks).toHaveLength(3 * 10 * waveformRate);
      expect(chunks[1]).toMatchObject({ offset: 10 * waveformRate });
      expect(chunks[1]!.peaks).toHaveLength(3 * Math.round(0.5 * waveformRate));
      expect(result!.peaks).toHaveLength(3 * ((whole + remainder) / waveformSampleRate) * waveformRate);
   });
});
