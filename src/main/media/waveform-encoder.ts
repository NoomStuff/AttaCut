import { waveformRate, waveformSampleRate } from "../../shared/media.ts";
export class WaveformEncoder {
   private readonly rate: number;
   constructor(rate = waveformRate) {
      this.rate = rate;
   }
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
      if (++this.filled < waveformSampleRate / this.rate) return;
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
   /** Release taken data between streamed chunks. */
   reset(): void {
      this.written = 0;
      this.taken = 0;
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
