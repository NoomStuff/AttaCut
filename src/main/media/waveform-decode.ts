import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";
import { WaveformEncoder } from "./waveform-encoder.ts";
import { waveformSampleRate, waveformResolution } from "../../shared/media.ts";
import { alignedAudioFilters } from "./audio-filter.ts";

export interface WaveformChunk {
   offset: number;
   peaks: Uint8Array;
   rate: number;
   priority?: boolean;
}
export interface WaveformResult {
   rate: number;
   buckets: number;
}
export interface WaveformRange {
   from: number;
   to: number;
}
export interface WaveformTimings {
   totalMs: number;
   encodeMs: number;
   deliveryMs: number;
   waitingMs: number;
}

/** Timestamp-aware audio scan or bounded region read, run in the waveform helper in Electron. */
export async function decodeWaveform(
   source: ProbedSource,
   tracks: number[],
   signal: AbortSignal | undefined,
   consume: (chunk: WaveformChunk) => Promise<void>,
   options: { decodePath?: string; wait?: () => Promise<void>; range?: WaveformRange; measure?: (timings: WaveformTimings) => void } = {}
): Promise<WaveformResult | null> {
   const audio = new Set(source.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index));
   if (!tracks.length || new Set(tracks).size !== tracks.length || tracks.some((index) => !audio.has(index))) return null;
   const rate = waveformResolution(source.duration);
   if (!rate) return null;
   const from = options.range ? Math.floor(Math.max(0, options.range.from) * rate) / rate : 0;
   const to = options.range ? Math.min(source.duration, Math.ceil(options.range.to * rate) / rate) : source.duration;
   if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || (options.range && to - from > 60.002)) return null;
   const duration = to - from;
   const firstBucket = Math.round(from * rate);
   const started = performance.now();
   let encodeMs = 0;
   let deliveryMs = 0;
   let waitingMs = 0;
   const encoder = new WaveformEncoder(rate);
   let buckets = 0;
   let lastSent = 0;
   const drain = async () => {
      if (!encoder.buffered()) return;
      const { peaks } = encoder.take();
      const deliveryStart = performance.now();
      await consume({ offset: firstBucket + buckets, peaks, rate });
      deliveryMs += performance.now() - deliveryStart;
      buckets += peaks.length / 3;
      encoder.reset();
      lastSent = performance.now();
   };
   // Prepared previews contain one mixed audio stream. Source stream numbers are invalid there.
   const indices = options.decodePath ? ["0:a:0"] : [...tracks].sort((a, b) => a - b).map((index) => `0:${index}`);
   // Mix in the source layout before reducing to mono. Otherwise FFmpeg negotiates
   // mono at amix and changes the gain of mono tracks mixed with stereo tracks.
   const layout = source.streams.filter((stream) => tracks.includes(stream.index)).sort((a, b) => (b.channels ?? 0) - (a.channels ?? 0))[0]?.channelLayout;
   const filters = alignedAudioFilters(indices, waveformSampleRate, layout, duration, from);
   await runMedia(
      "ffmpeg",
      [
         "-hide_banner",
         "-loglevel",
         "error",
         "-nostdin",
         "-threads",
         "1",
         "-copyts",
         "-start_at_zero",
         ...(from ? ["-ss", String(from)] : []),
         "-i",
         options.decodePath ?? source.path,
         ...(options.range ? ["-t", String(duration)] : []),
         "-vn",
         ...filters,
         "-ac",
         "1",
         "-ar",
         String(waveformSampleRate),
         "-f",
         "s16le",
         "-",
      ],
      {
         priority: "background",
         belowNormal: true,
         signal,
         onBytes: async (chunk) => {
            const waitStart = performance.now();
            await options.wait?.();
            waitingMs += performance.now() - waitStart;
            signal?.throwIfAborted();
            const encodingStart = performance.now();
            encoder.push(chunk);
            encodeMs += performance.now() - encodingStart;
            if (buckets + encoder.buffered() > Math.ceil(duration * rate) + 1) throw new Error("Waveform exceeded its duration budget.");
            if ((!buckets && encoder.buffered() >= rate / 4) || encoder.buffered() * 3 >= 65536 || performance.now() - lastSent >= 80) await drain();
         },
      }
   );
   encoder.finish();
   await drain();
   options.measure?.({ totalMs: performance.now() - started, encodeMs, deliveryMs, waitingMs });
   return { rate, buckets };
}
