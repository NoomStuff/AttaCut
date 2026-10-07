/** Resume every pending cache/PCM consumer, including waits interrupted by another pause. */
export class WaveformGate {
   private paused = true;
   private closed = false;
   private waiting = new Set<() => void>();
   pause(): void {
      if (!this.closed) this.paused = true;
   }
   resume(): void {
      this.paused = false;
      for (const wake of this.waiting) wake();
      this.waiting.clear();
   }
   close(): void {
      this.closed = true;
      this.resume();
   }
   async wait(): Promise<void> {
      while (this.paused) await new Promise<void>((resolve) => this.waiting.add(resolve));
   }
}
