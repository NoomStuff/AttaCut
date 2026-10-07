/**
 * Audio scrubbing: short bursts from the playhead while the picture is paused, so trimming
 * and stepping are audible. Runs through WebAudio beside the video element, which stays
 * untouched; bursts are cut short the moment real playback starts.
 */
import type { ScrubAudio } from "../../../shared/types";
import { scrubChunkSeconds } from "../../../shared/media";
type Audition = { time: number; volume: number; side: "start" | "end" };
export class AudioScrubber {
   private context: AudioContext | null = null;
   private buffer: AudioBuffer | null = null;
   private previous: { start: number; buffer: AudioBuffer } | null = null;
   private voice: AudioBufferSourceNode | null = null;
   private gain: GainNode | null = null;
   private pending: Audition | null = null;
   private lastAudition: Audition | null = null;
   private auditionTimer = 0;
   private decoding: { view: DataView; frames: number; position: number } | null = null;
   private timer = 0;
   private lastScrub = -Infinity;
   private start = 0;
   private generation = 0;
   private loading = -1;
   private loadTimer = 0;
   private lastLoad = -Infinity;
   private load: ((time: number) => Promise<ScrubAudio | null>) | null = null;

   configure(load: ((time: number) => Promise<ScrubAudio | null>) | null): void {
      this.reset();
      this.load = load;
   }
   /** Warm only after the video's first frame, while playback is idle. */
   prefetch(time: number): void {
      if (this.buffer && time >= this.start && time < this.start + this.buffer.duration) return;
      this.request(time);
   }
   /** Playback takes priority over unfinished PCM work, retaining completed chunks. */
   suspend(): void {
      this.stop();
      this.generation++;
      this.loading = -1;
      if (this.decoding) this.cancelDecode();
   }
   reset(): void {
      this.generation++;
      this.loading = -1;
      this.load = null;
      this.stop();
      this.previous = null;
      this.cancelDecode();
      this.lastScrub = -Infinity;
      this.lastLoad = -Infinity;
   }
   dispose(): void {
      this.reset();
      void this.context?.close();
      this.context = null;
   }
   private request(time: number): void {
      const start = Math.floor(time / scrubChunkSeconds) * scrubChunkSeconds;
      window.clearTimeout(this.loadTimer);
      this.loadTimer = 0;
      if (!this.load || this.loading === start) return;
      // Keep the first cold request immediate, then coalesce moving across uncached
      // chunks. Pointer events can arrive faster than FFmpeg can even start.
      const wait = 100 - (performance.now() - this.lastLoad);
      if (wait > 0) {
         this.loadTimer = window.setTimeout(() => this.request(time), wait);
         return;
      }
      this.lastLoad = performance.now();
      const generation = ++this.generation;
      this.loading = start;
      this.stopVoice();
      // Keep the outgoing chunk so scrubbing back and forth over a boundary does not
      // re-request the same chunk on every crossing; it is swapped back in by scrub().
      this.previous = this.buffer ? { start: this.start, buffer: this.buffer } : null;
      this.cancelDecode();
      void this.load(start)
         .then((data) => {
            if (generation !== this.generation) return;
            this.loading = -1;
            if (data) {
               if (this.buffer && this.start !== data.start) this.previous = { start: this.start, buffer: this.buffer };
               this.start = data.start;
               this.setPcm(data.pcm, data.sampleRate);
               this.flush();
            } else if (!this.loadTimer) this.pending = null;
         })
         .catch(() => {
            if (generation === this.generation) {
               this.loading = -1;
               if (!this.loadTimer) this.pending = null;
            }
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

   /** Audition a new position, coalescing fast movement without replaying a snapped frame. */
   scrub(time: number, volume: number, side: "start" | "end" = "start"): void {
      if (volume <= 0) {
         this.stop();
         return;
      }
      this.pending = { time, volume, side };
      this.flush();
   }

   private flush(): void {
      const audition = this.pending;
      if (!audition) return;
      const { time, volume, side } = audition;
      const sameSample = this.lastAudition?.side === side && Math.abs(time - this.lastAudition.time) < 1 / (this.buffer?.sampleRate ?? 22050);
      if (sameSample) {
         this.pending = null;
         window.clearTimeout(this.auditionTimer);
         this.auditionTimer = 0;
         return;
      }
      // An end handle auditions the kept audio before the cut, not the discarded audio after it.
      const position = side === "end" ? Math.max(0, time - 0.16) : time;
      const covers = (chunk: { start: number; buffer: AudioBuffer } | null) =>
         !!chunk && position >= chunk.start && position < chunk.start + chunk.buffer.duration;
      const current = this.buffer ? { start: this.start, buffer: this.buffer } : null;
      if (!covers(current)) {
         if (this.previous && covers(this.previous)) {
            this.buffer = this.previous.buffer;
            this.start = this.previous.start;
            this.previous = current;
         } else {
            this.request(position);
            return;
         }
      }
      window.clearTimeout(this.loadTimer);
      this.loadTimer = 0;
      const stamp = performance.now();
      const wait = 50 - (stamp - this.lastScrub);
      if (wait > 0) {
         if (!this.auditionTimer)
            this.auditionTimer = window.setTimeout(() => {
               this.auditionTimer = 0;
               this.flush();
            }, wait);
         return;
      }
      window.clearTimeout(this.auditionTimer);
      this.auditionTimer = 0;
      this.pending = null;
      const buffer = this.buffer!;
      const offset = position - this.start;
      const burst = Math.min(0.16, buffer.duration - offset, side === "end" ? time - position : Infinity);
      if (burst <= 0) return;
      this.lastScrub = stamp;
      this.lastAudition = audition;
      this.stopVoice();
      const context = this.ensureContext();
      const voice = context.createBufferSource();
      voice.buffer = buffer;
      const gain = context.createGain();
      const now = context.currentTime;
      const attack = Math.min(0.005, burst / 3);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + attack);
      gain.gain.setValueAtTime(volume, now + Math.max(attack, burst - 0.03));
      gain.gain.linearRampToValueAtTime(0, now + burst);
      voice.connect(gain).connect(context.destination);
      voice.start(now, offset, burst);
      this.voice = voice;
      this.gain = gain;
      voice.onended = () => {
         voice.disconnect();
         gain.disconnect();
         if (this.voice === voice) {
            this.voice = null;
            this.gain = null;
         }
      };
   }

   stop(): void {
      window.clearTimeout(this.loadTimer);
      this.loadTimer = 0;
      window.clearTimeout(this.auditionTimer);
      this.auditionTimer = 0;
      this.pending = null;
      this.lastAudition = null;
      this.lastScrub = -Infinity;
      this.stopVoice();
   }

   private stopVoice(): void {
      const voice = this.voice;
      const gain = this.gain;
      this.voice = null;
      this.gain = null;
      if (voice) {
         try {
            const now = this.context!.currentTime;
            gain!.gain.cancelScheduledValues(now);
            gain!.gain.setValueAtTime(gain!.gain.value, now);
            gain!.gain.linearRampToValueAtTime(0, now + 0.008);
            voice.stop(now + 0.01);
         } catch {
            // The burst had already finished.
         }
      }
   }
}
