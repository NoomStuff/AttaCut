import { useEffect, useRef, useState } from "react";
import type { MediaSource } from "../../../shared/types";
import { waveformLevels, waveformRate } from "../../../shared/media";
import { afterIdle } from "./prefetch";

export interface Waveform {
   /** One entry per level of waveformLevels, finest first. Each level stores the per-bucket
       extent below and above zero plus the RMS core, scaled 0-255; coarser levels fold ten
       of the level below, the RMS through a quadratic mean. */
   levels: { rate: number; down: Uint8Array; up: Uint8Array; rms: Uint8Array }[];
   /** Fraction of the source decoded so far, 1 once complete. Drives the reveal sweep. */
   filled: number;
}

/** The folding factor between waveform levels. */
const fold = 10;
const cacheLimit = 3;

function foldBucketLevel(
   source: { down: Uint8Array; up: Uint8Array; rms: Uint8Array },
   target: { down: Uint8Array; up: Uint8Array; rms: Uint8Array },
   bucket: number
): void {
   let down = 0;
   let up = 0;
   let squares = 0;
   let count = 0;
   for (let part = bucket * fold, last = Math.min(part + fold, source.down.length); part < last; part++, count++) {
      down = Math.max(down, source.down[part]!);
      up = Math.max(up, source.up[part]!);
      squares += source.rms[part]! * source.rms[part]!;
   }
   target.down[bucket] = down;
   target.up[bucket] = up;
   target.rms[bucket] = count ? Math.round(Math.sqrt(squares / count)) : 0;
}

function fill(levels: Waveform["levels"], offset: number, peaks: Uint8Array): void {
   const fine = levels[0]!;
   const end = Math.min(offset + peaks.length / 3, fine.down.length);
   for (let bucket = offset, value = 0; bucket < end; bucket++, value += 3) {
      fine.down[bucket] = peaks[value]!;
      fine.up[bucket] = peaks[value + 1]!;
      fine.rms[bucket] = peaks[value + 2]!;
   }
   let from = offset;
   let to = end;
   for (let level = 1; level < levels.length; level++) {
      const source = levels[level - 1]!;
      const target = levels[level]!;
      const stop = Math.min(Math.ceil(to / fold), target.down.length);
      for (let bucket = Math.floor(from / fold); bucket < stop; bucket++) foldBucketLevel(source, target, bucket);
      from /= fold;
      to /= fold;
   }
}

/**
 * Audio min/max peaks of the active source for the timeline waveform, following the
 * playback audio selection. Decoding waits for the preview's first frame and then runs in
 * the background, streaming peak ranges back as they are done; results stay cached per
 * source and track selection until they change.
 */
export function useWaveform({
   source,
   enabled,
   audioIndices,
   decodeMediaId,
}: {
   source: MediaSource | null;
   enabled: boolean;
   audioIndices: number[];
   /** Media id to decode from: the source itself, or the prepared preview once a
       recording that needs a transcode has swapped to it. Null holds the fetch. */
   decodeMediaId: string | null;
}): Waveform | null {
   const [waveform, setWaveform] = useState<Waveform | null>(null);
   const cache = useRef(new Map<string, Waveform>());
   const signature = source && audioIndices.length && source.duration > 0 ? `${source.id}:${audioIndices.join(",")}` : null;
   useEffect(() => {
      if (!signature || !source || !enabled) {
         // Peaks can reach tens of megabytes for long recordings; drop them once unused.
         cache.current.clear();
         setWaveform(null);
         return;
      }
      for (const key of [...cache.current.keys()]) if (!key.startsWith(`${source.id}:`)) cache.current.delete(key);
      const cached = cache.current.get(signature);
      if (cached) {
         setWaveform(cached);
         return;
      }
      // No preview to decode from yet: recordings that need a transcode get their waveform
      // from that compact preview instead of walking the huge source, so hold until the
      // player swaps to it.
      if (!decodeMediaId) return;
      let cancelled = false;
      let unsubscribe = () => {};
      let notifyTimer = 0;
      let cancelIdle = () => {};
      const read = async () => {
         const levels = waveformLevels.map((rate) => ({
            rate,
            down: new Uint8Array(Math.ceil(source.duration * rate)),
            up: new Uint8Array(Math.ceil(source.duration * rate)),
            rms: new Uint8Array(Math.ceil(source.duration * rate)),
         }));
         const total = Math.ceil(source.duration * waveformRate);
         let done = 0;
         let pendingNotify = false;
         const notify = () => {
            if (!cancelled) setWaveform({ levels, filled: Math.min(1, done / total) });
         };
         unsubscribe = window.desktop.onWaveformChunk((chunk) => {
            if (cancelled || chunk.sourceId !== source.id) return;
            fill(levels, chunk.offset, chunk.peaks);
            done = Math.max(done, chunk.offset + chunk.peaks.length / 3);
            // Decoding is far faster than painting; settle for a few progressive frames.
            if (!pendingNotify) {
               pendingNotify = true;
               notifyTimer = window.setTimeout(() => {
                  pendingNotify = false;
                  notify();
               }, 120);
            }
         });
         try {
            const result = await window.desktop.waveformStart({ sourceId: source.id, streamIndices: audioIndices, decodeMediaId });
            if (cancelled) return;
            window.clearTimeout(notifyTimer);
            unsubscribe();
            if (!result) return;
            // The final buffer outruns any chunk still in flight, so refill from it.
            fill(levels, 0, result.peaks);
            const complete = { levels, filled: 1 };
            cache.current.set(signature, complete);
            while (cache.current.size > cacheLimit) cache.current.delete(cache.current.keys().next().value!);
            setWaveform(complete);
         } catch {
            window.clearTimeout(notifyTimer);
            unsubscribe();
            notify();
            // A waveform is decoration: a failed decode leaves it partial without an error,
            // and diagnostics already recorded the ffmpeg outcome.
         }
      };
      // The waveform reads the source file directly and must not wait for the preview: a
      // recording that needs a transcode would otherwise hold the waveform hostage for the
      // whole encode. A short settle keeps the very first open frame responsive.
      cancelIdle = afterIdle(() => void read(), 150);
      return () => {
         cancelled = true;
         unsubscribe();
         cancelIdle();
         window.clearTimeout(notifyTimer);
         void window.desktop.cancelWaveform().catch(() => undefined);
      };
   }, [source, enabled, signature, audioIndices, decodeMediaId]);
   return waveform;
}

/**
 * Paints one waveform band: the source range `[from, to)` across `width` device pixels,
 * reading the coarsest mip level that stays finer than a pixel column. The min/max band
 * renders lighter with the RMS core on top, which keeps loud passages readable instead of
 * collapsing into a solid rectangle. Columns beyond `revealedSeconds` stay untouched, and
 * while decoding is incomplete the `fadeSeconds` before that edge is erased with a
 * gradient so the sweep has no seam.
 */
export function drawWaveformBand({
   context,
   waveform,
   from,
   to,
   width,
   height,
   color,
   revealedSeconds,
   fadeSeconds,
   alpha = 1,
}: {
   context: CanvasRenderingContext2D;
   waveform: Waveform;
   from: number;
   to: number;
   width: number;
   height: number;
   color: string;
   revealedSeconds: number;
   fadeSeconds: number;
   alpha?: number;
}): void {
   context.clearRect(0, 0, width, height);
   if (to - from <= 0 || width <= 0 || revealedSeconds <= from) return;
   const mid = height / 2;
   const level = waveform.levels.findLast((candidate) => candidate.rate >= width / (to - from)) ?? waveform.levels[waveform.levels.length - 1]!;
   const { down, up, rms, rate } = level;
   const span = ((to - from) / width) * rate;
   const edge = Math.min(revealedSeconds, to);
   const peaks = new Path2D();
   const core = new Path2D();
   const columns = Math.ceil(((edge - from) / (to - from)) * width);
   for (let column = 0; column < columns; column++) {
      const position = (from + (column / width) * (to - from)) * rate;
      let low: number;
      let high: number;
      let middle: number;
      if (span < 1) {
         const first = Math.floor(position);
         const fraction = position - first;
         high = interpolate(up, first, fraction);
         low = interpolate(down, first, fraction);
         middle = interpolate(rms, first, fraction);
      } else {
         high = 0;
         low = 0;
         let squareSum = 0;
         let count = 0;
         for (let bucket = Math.floor(position), last = Math.min(Math.ceil(position + span), up.length); bucket < last; bucket++) {
            if (up[bucket]! > high) high = up[bucket]!;
            if (down[bucket]! > low) low = down[bucket]!;
            squareSum += rms[bucket]! * rms[bucket]!;
            count++;
         }
         middle = count ? Math.round(Math.sqrt(squareSum / count)) : 0;
      }
      const top = (high / 255) * mid;
      const bottom = (low / 255) * mid;
      const center = (middle / 255) * mid;
      if (top + bottom >= 1) peaks.rect(column, mid - top, 1, top + bottom);
      if (center >= 0.5) core.rect(column, mid - center, 1, center * 2);
   }
   // The peaks frame the dynamics; the RMS core carries the readable shape on top. The
   // peaks fade toward the band's edges, so a saturated loud passage reads as a band
   // rather than a hard rectangle.
   context.fillStyle = color;
   const solid = context.fillStyle as unknown as string;
   if (typeof solid === "string" && /^#([0-9a-f]{6})$/i.test(solid)) {
      const fade = context.createLinearGradient(0, 0, 0, height);
      fade.addColorStop(0, `${solid}6e`);
      fade.addColorStop(0.5, solid);
      fade.addColorStop(1, `${solid}6e`);
      context.fillStyle = fade;
   }
   context.globalAlpha = alpha * 0.55;
   context.fill(peaks);
   context.globalAlpha = alpha;
   context.fillStyle = color;
   context.fill(core);
   // Soften the leading edge while decoding: erase linearly across the fade band so the
   // sweep has no seam. A finished decode never fades, or the end of the timeline would
   // keep a permanent notch.
   const fadeStart = edge - fadeSeconds;
   if (revealedSeconds < waveformDuration(waveform) - 0.001 && fadeStart < edge) {
      const start = Math.max(0, ((fadeStart - from) / (to - from)) * width);
      const end = Math.min(width, ((edge - from) / (to - from)) * width);
      if (end > start) {
         const erase = context.createLinearGradient(start, 0, end, 0);
         erase.addColorStop(0, "rgba(0, 0, 0, 0)");
         erase.addColorStop(1, "rgba(0, 0, 0, 1)");
         context.globalCompositeOperation = "destination-out";
         context.fillStyle = erase;
         context.fillRect(start, 0, end - start, height);
         context.globalCompositeOperation = "source-over";
      }
   }
   context.globalAlpha = 1;
}
function interpolate(values: Uint8Array, first: number, fraction: number): number {
   const here = values[first] ?? 0;
   const next = values[first + 1] ?? here;
   return here + (next - here) * fraction;
}

/** Source seconds of a waveform, from its finest level's coverage. */
export function waveformDuration(waveform: Waveform): number {
   return waveform.levels[0]!.down.length / waveform.levels[0]!.rate;
}
