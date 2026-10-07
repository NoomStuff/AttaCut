/** A bounded reveal in elapsed time, independent of recording duration and chunk size. */
export class WaveformReveal {
   private from: number;
   private target: number;
   private started = 0;
   private readonly duration = 240;
   constructor(initial = 0) {
      this.from = initial;
      this.target = initial;
   }
   retarget(seconds: number, now: number): void {
      if (seconds <= this.target) return;
      this.from = this.frame(now).seconds;
      this.target = seconds;
      this.started = now;
   }
   frame(now: number, reducedMotion = false): { seconds: number; active: boolean } {
      const fraction = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - this.started) / this.duration));
      return { seconds: this.from + (this.target - this.from) * (1 - (1 - fraction) ** 3), active: fraction < 1 && this.from < this.target };
   }
}
