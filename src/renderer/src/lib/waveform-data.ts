import { waveformLevels, waveformResolution } from "../../../shared/media";

export interface WaveformData {
   /** One entry per level of waveformLevels, finest first. Each level stores the per-bucket
       extent below and above zero plus the RMS core, scaled 0-255; coarser levels fold ten
       of the level below. RMS folding reverses the square-root display curve first. */
   levels: { rate: number; down: Uint8Array; up: Uint8Array; rms: Uint8Array }[];
   /** Fraction of the source decoded so far, 1 once complete. Drives the reveal sweep. */
   filled: number;
}

/** The folding factor between waveform levels. */
const fold = 10;

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
      squares += source.rms[part]! ** 4;
   }
   target.down[bucket] = down;
   target.up[bucket] = up;
   target.rms[bucket] = count ? Math.round(Math.sqrt(Math.sqrt(squares / count))) : 0;
}

export function fillWaveformData(levels: WaveformData["levels"], offset: number, peaks: Uint8Array): void {
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
 * Paints one waveform band: the source range `[from, to)` across `width` device pixels,
 * reading the coarsest mip level that stays finer than a pixel column. The min/max band
 * renders lighter with the RMS core on top, which keeps loud passages readable instead of
 * collapsing into a solid rectangle. Columns beyond `revealedSeconds` stay untouched, and
 * while decoding is incomplete the `fadeSeconds` before that edge is erased with a
 * gradient so the sweep has no seam.
 */
export function drawWaveformDataBand({
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
   context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
   waveform: WaveformData;
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
   const level = waveform.levels.findLast((candidate) => candidate.rate >= width / (to - from)) ?? waveform.levels[0]!;
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
            squareSum += rms[bucket]! ** 4;
            count++;
         }
         middle = count ? Math.round(Math.sqrt(Math.sqrt(squareSum / count))) : 0;
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
   // A fresh partial band must remain readable before it spans the full fade width.
   const fadeStart = edge - Math.min(fadeSeconds, (edge - from) / 4);
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
export function waveformDuration(waveform: WaveformData): number {
   return waveform.levels[0]!.down.length / waveform.levels[0]!.rate;
}

export function createWaveformData(duration: number): WaveformData {
   const rate = waveformResolution(duration);
   return {
      filled: 0,
      levels: waveformLevels
         .filter((value) => value <= rate)
         .map((rate) => ({
            rate,
            down: new Uint8Array(Math.ceil(duration * rate)),
            up: new Uint8Array(Math.ceil(duration * rate)),
            rms: new Uint8Array(Math.ceil(duration * rate)),
         })),
   };
}
