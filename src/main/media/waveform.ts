import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";
import { recordDiagnostic } from "../diagnostics";
import { waveformRate, waveformSampleRate } from "../../shared/media.ts";

/** Seconds of audio per streamed chunk: small enough that the first paint lands quickly. */
const chunkSeconds = 2.5;
const samplesPerBucket = waveformSampleRate / waveformRate;

/**
 * Folds streamed mono 16-bit PCM into per-millisecond waveform buckets. Each bucket keeps
 * the most negative and most positive sample plus its RMS level; all three are scaled
 * 0-255 through a square-root curve. Rendering pairs the min/max band with the RMS core so
 * deep zooms show the shape of the audio instead of a saturated rectangle. Chunks may
 * split a sample across calls; the low byte is carried until its pair arrives. Buckets
 * land in one growing interleaved [down, up, rms, …] buffer; `take` hands out the range
 * completed since the last call.
 */
export class WaveformEncoder {
   private all = new Uint8Array(1 << 12);
   private written = 0;
   private taken = 0;
   private low = 0;
   private high = 0;
   private squares = 0;
   private filled = 0;
   private carry: number | null = null;

   push(chunk: Uint8Array): void {
      let offset = 0;
      if (this.carry !== null) {
         if (!chunk.length) return;
         this.sample(this.carry! | (chunk[0]! << 8));
         this.carry = null;
         offset = 1;
      }
      const samples = (chunk.length - offset) >> 1;
      for (let index = 0; index < samples; index++) {
         const byte = offset + index * 2;
         this.sample(chunk[byte]! | (chunk[byte + 1]! << 8));
      }
      if ((chunk.length - offset) & 1) this.carry = chunk[chunk.length - 1]!;
   }
   private sample(raw: number): void {
      const value = (raw << 16) >> 16;
      if (value < this.low) this.low = value;
      if (value > this.high) this.high = value;
      this.squares += value * value;
      if (++this.filled < samplesPerBucket) return;
      this.storeBucket();
   }
   private storeBucket(): void {
      if (this.written + 3 > this.all.length) {
         const grown = new Uint8Array(Math.max(this.all.length * 2, this.written + 3));
         grown.set(this.all);
         this.all = grown;
      }
      this.all[this.written++] = scale(this.low);
      this.all[this.written++] = scale(this.high);
      this.all[this.written++] = scale(Math.sqrt(this.squares / this.filled));
      this.low = 0;
      this.high = 0;
      this.squares = 0;
      this.filled = 0;
   }
   /** Buckets completed but not yet taken. */
   buffered(): number {
      return (this.written - this.taken) / 3;
   }
   take(): { offset: number; peaks: Uint8Array } {
      const peaks = this.all.subarray(this.taken, this.written);
      const offset = this.taken / 3;
      this.taken = this.written;
      return { offset, peaks };
   }
   /** Every bucket completed so far. */
   complete(): Uint8Array {
      return this.all.subarray(0, this.written);
   }
   /** Flushes any partial bucket; call once the stream ends. */
   finish(): void {
      if (this.filled > 0) this.storeBucket();
   }
}
function scale(value: number): number {
   return Math.round(Math.sqrt(Math.abs(value) / 32768) * 255);
}

/** Peak min/max pairs for the whole audio of the selected tracks, decoded in one seek-free
    pass. `decodePath` may point at a prepared preview instead of the source: a compact,
    well-indexed file whose walk is cheap, where huge interleaved recordings can take
    minutes of pure IO. `onChunk` delivers completed ranges left to right; the resolved
    buffer is the complete interleaved result. Returns null when a track index does not
    name an audio stream. */
export async function extractWaveform(
   source: ProbedSource,
   streamIndices: number[],
   signal: AbortSignal | undefined,
   onChunk?: (chunk: { offset: number; peaks: Uint8Array }) => void,
   options?: { decodePath?: string }
): Promise<{ peaks: Uint8Array } | null> {
   const available = new Set(source.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index));
   if (!streamIndices.length || streamIndices.some((index) => !available.has(index))) return null;
   const encoder = new WaveformEncoder();
   const drain = () => {
      if (onChunk && encoder.buffered() > 0) onChunk(encoder.take());
   };
   let firstChunkAt = 0;
   const started = performance.now();
   await runMedia(
      "ffmpeg",
      [
         "-hide_banner",
         "-loglevel",
         "error",
         "-nostdin",
         "-i",
         options?.decodePath ?? source.path,
         "-vn",
         ...(streamIndices.length === 1
            ? ["-map", `0:${streamIndices[0]}`]
            : [
                 "-filter_complex",
                 `${streamIndices.map((index) => `[0:${index}]`).join("")}amix=inputs=${streamIndices.length}:duration=longest[a]`,
                 "-map",
                 "[a]",
              ]),
         "-ac",
         "1",
         "-ar",
         String(waveformSampleRate),
         "-f",
         "s16le",
         "-",
      ],
      {
         // Waveforms decorate the timeline; seeks, preview decodes, and exports outrank them.
         priority: "background",
         belowNormal: true,
         signal,
         onBytes: (chunk) => {
            encoder.push(chunk);
            if (!firstChunkAt) {
               firstChunkAt = performance.now();
               recordDiagnostic("waveform:first-chunk", firstChunkAt - started);
            }
            if (encoder.buffered() >= chunkSeconds * waveformRate) drain();
         },
      }
   );
   encoder.finish();
   drain();
   recordDiagnostic("waveform:decode", performance.now() - started);
   return { peaks: encoder.complete() };
}
