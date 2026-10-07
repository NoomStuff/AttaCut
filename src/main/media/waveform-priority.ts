import type { WaveformRange } from "./waveform-decode";

/** Coalesce settled viewport requests. A new view cancels only its obsolete short read. */
export class WaveformPriority {
   private pending: WaveformRange | null = null;
   private active: AbortController | null = null;
   private running: WaveformRange | null = null;
   private completed: WaveformRange[] = [];
   private duration: number;
   private signal: AbortSignal;
   constructor(duration: number, signal: AbortSignal) {
      this.duration = duration;
      this.signal = signal;
   }
   request(from: number, to: number): void {
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      from = Math.max(0, from);
      to = Math.min(this.duration, to);
      if (to <= from || to - from > 60 || this.completed.some((range) => range.from <= from && range.to >= to)) return;
      if (this.pending?.from === from && this.pending.to === to) return;
      if (this.running?.from === from && this.running.to === to) return;
      this.pending = { from, to };
      this.active?.abort();
   }
   async read(covered: number, decode: (range: WaveformRange, signal: AbortSignal) => Promise<void>): Promise<void> {
      const range = this.pending;
      if (!range) return;
      this.pending = null;
      // The sequential decoder is already approaching this region. Starting a second
      // decoder at the beginning would add work without making useful data arrive sooner.
      if (range.from <= covered + 5 || this.signal.aborted) return;
      const controller = new AbortController();
      this.active = controller;
      this.running = range;
      try {
         await decode(range, AbortSignal.any([this.signal, controller.signal]));
         if (!controller.signal.aborted) {
            this.completed.push(range);
            if (this.completed.length > 128) this.completed.shift();
         }
      } catch (error) {
         // A failed optional region never prevents the sequential scan from completing.
         if (this.signal.aborted) throw error;
      } finally {
         if (this.active === controller) this.active = null;
         this.running = null;
      }
   }
}
