/**
 * Audio scrubbing: short bursts from the playhead while the picture is paused, so trimming
 * and stepping are audible. Runs through WebAudio beside the video element, which stays
 * untouched; bursts are cut short the moment real playback starts.
 */
import type { ScrubAudio } from "../../../shared/types";
export class AudioScrubber {
   private context: AudioContext | null = null;
   private buffer: AudioBuffer | null = null;
   private previous: { start: number; buffer: AudioBuffer } | null = null;
   private voice: AudioBufferSourceNode | null = null;
   private decoding: { view: DataView; frames: number; position: number } | null = null;
   private timer = 0;
   private lastScrub = -Infinity;
   private start = 0;
   private generation = 0;
   private loading = -1;
   private load: ((time: number) => Promise<ScrubAudio | null>) | null = null;

   configure(load: ((time: number) => Promise<ScrubAudio | null>) | null): void {
      this.reset();
      this.load = load;
      if (load) this.request(0);
   }
   reset(): void {
      this.generation++;
      this.loading = -1;
      this.load = null;
      this.stop();
      this.previous = null;
      this.cancelDecode();
      this.lastScrub = -Infinity;
   }
   dispose(): void {
      this.reset();
      void this.context?.close();
      this.context = null;
   }
   private request(time: number): void {
      const start = Math.floor(time / 30) * 30;
      if (!this.load || this.loading === start) return;
      const generation = ++this.generation;
      this.loading = start;
      this.stop();
      // Keep the outgoing chunk so scrubbing back and forth over a boundary does not
      // re-request the same chunk on every crossing; it is swapped back in by scrub().
      this.previous = this.buffer ? { start: this.start, buffer: this.buffer } : null;
      this.cancelDecode();
      void this.load(start)
         .then((data) => {
            if (generation !== this.generation) return;
            this.loading = -1;
            if (data) {
               this.start = data.start;
               this.setPcm(data.pcm, data.sampleRate);
            }
         })
         .catch(() => {
            if (generation === this.generation) this.loading = -1;
         });
   }

   /** Decode mono 16-bit PCM progressively so long recordings never block the interface. */
   setPcm(pcm: ArrayBuffer, sampleRate: number): void {
      this.cancelDecode();
      const frames = Math.floor(pcm.byteLength / 2);
      if (!frames) return;
      this.buffer = this.ensureContext().createBuffer(1, frames, sampleRate);
      this.decoding = { view: new DataView(pcm), frames, position: 0 };
      this.decodeNext();
   }

   private decodeNext(): void {
      const task = this.decoding;
      const buffer = this.buffer;
      if (!task || !buffer) return;
      const channel = buffer.getChannelData(0);
      const end = Math.min(task.frames, task.position + 4_000_000);
      for (let i = task.position; i < end; i++) channel[i] = task.view.getInt16(i * 2, true) / 32768;
      task.position = end;
      if (end < task.frames) this.timer = window.setTimeout(() => this.decodeNext(), 0);
      else this.decoding = null;
   }

   private cancelDecode(): void {
      window.clearTimeout(this.timer);
      this.decoding = null;
      this.buffer = null;
   }

   private ensureContext(): AudioContext {
      if (!this.context) this.context = new AudioContext();
      if (this.context.state === "suspended") void this.context.resume();
      return this.context;
   }

   /** Play a short burst starting at `time`; each call replaces the previous burst. Dense
      pointer input re-triggers at most every 50ms — the playing burst already covers that. */
   scrub(time: number, volume: number): void {
      if (volume <= 0) {
         this.stop();
         return;
      }
      const covers = (chunk: { start: number; buffer: AudioBuffer } | null) => !!chunk && time >= chunk.start && time < chunk.start + chunk.buffer.duration;
      const current = this.buffer ? { start: this.start, buffer: this.buffer } : null;
      if (!covers(current)) {
         if (this.previous && covers(this.previous)) {
            // Re-entering the retained neighbor chunk: swap the two instead of reloading.
            const swapped = current;
            this.buffer = this.previous.buffer;
            this.start = this.previous.start;
            this.previous = swapped;
         } else {
            this.request(time);
            return;
         }
      }
      const buffer = this.buffer!;
      time -= this.start;
      const stamp = performance.now();
      if (stamp - this.lastScrub < 50) return;
      this.lastScrub = stamp;
      this.stop();
      const context = this.ensureContext();
      const voice = context.createBufferSource();
      voice.buffer = buffer;
      const gain = context.createGain();
      const now = context.currentTime;
      const burst = Math.min(0.16, buffer.duration - time);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.setValueAtTime(volume, now + Math.max(0, burst - 0.03));
      gain.gain.linearRampToValueAtTime(0, now + burst);
      voice.connect(gain).connect(context.destination);
      voice.start(now, time, burst);
      this.voice = voice;
      voice.onended = () => {
         if (this.voice === voice) this.voice = null;
      };
   }

   stop(): void {
      const voice = this.voice;
      this.voice = null;
      if (voice) {
         voice.onended = null;
         try {
            voice.stop();
         } catch {
            // The burst had already finished.
         }
      }
   }
}
