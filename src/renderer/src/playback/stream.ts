/** Seconds of decoded stream kept ahead of the playhead; the feed pauses beyond this. */
const aheadSeconds = 20;
/** Seconds kept behind the playhead for short rewinds and frame steps. */
const behindSeconds = 20;
/** A seek this close past the feed's progress waits for the feed instead of restarting it. */
const catchUpSeconds = 2;

/** The `avc1.PPCCLL` codec string from an init segment's avcC box, once it has arrived. */
export function avcCodec(bytes: Uint8Array): string | null {
   for (let index = 4; index + 8 <= bytes.length; index++) {
      if (bytes[index] === 0x61 && bytes[index + 1] === 0x76 && bytes[index + 2] === 0x63 && bytes[index + 3] === 0x43) {
         const hex = (value: number) => value.toString(16).padStart(2, "0");
         return `avc1.${hex(bytes[index + 5]!)}${hex(bytes[index + 6]!)}${hex(bytes[index + 7]!)}`;
      }
   }
   return null;
}

/** The streamed preview's MIME type is fixed: H.264 video with FLAC audio. */
export function streamingSupported(): boolean {
   return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028,flac"');
}

function rangeAt(ranges: TimeRanges, time: number): { start: number; end: number } | null {
   for (let index = 0; index < ranges.length; index++) {
      const start = ranges.start(index);
      const end = ranges.end(index);
      if (start <= time + 0.0005 && time < end) return { start, end };
   }
   return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
   const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
   let offset = 0;
   for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
   }
   return result;
}

/**
 * Plays a source Chromium cannot open by feeding a MediaSource from `media://stream/`.
 * Only the region around the playhead is decoded: a seek outside the buffer restarts the
 * feed there, and the feed pauses once it is far enough ahead.
 */
export class PreviewStream {
   readonly url: string;
   private readonly media = new MediaSource();
   private buffer: SourceBuffer | null = null;
   private video: HTMLVideoElement | null = null;
   private feed: { controller: AbortController; from: number; end: number; done: boolean } | null = null;
   private wake: (() => void) | null = null;
   private disposed = false;
   private readonly sourceId: string;
   private readonly duration: number;
   private readonly tracks: number[];
   private readonly onError: (error: Error) => void;

   constructor(options: {
      sourceId: string;
      duration: number;
      tracks: number[];
      /** The player element; it can mount after the stream is created. */
      video: () => HTMLVideoElement | null;
      start: number;
      onError: (error: Error) => void;
   }) {
      this.sourceId = options.sourceId;
      this.duration = options.duration;
      this.tracks = options.tracks;
      this.onError = options.onError;
      this.url = URL.createObjectURL(this.media);
      this.media.addEventListener(
         "sourceopen",
         () => {
            const video = options.video();
            if (this.disposed || !video) return;
            this.video = video;
            video.addEventListener("seeking", this.seeking);
            video.addEventListener("timeupdate", this.progress);
            video.addEventListener("ratechange", this.progress);
            this.media.duration = this.duration;
            this.start(Math.max(0, Math.min(options.start, this.duration)));
         },
         { once: true }
      );
   }

   /** Only the element currently showing this stream drives it. */
   private get active(): HTMLVideoElement | null {
      const video = this.video;
      return video && !this.disposed && video.currentSrc === this.url ? video : null;
   }

   private readonly seeking = () => {
      const video = this.active;
      if (!video || this.media.readyState === "closed") return;
      const time = video.currentTime;
      const range = rangeAt(video.buffered, time);
      const feed = this.feed;
      if (range) {
         // Keep filling forward from the end of what is already here, unless the feed
         // already extends this range or the range reaches the end of the recording.
         const extending = feed !== null && Math.abs(feed.end - range.end) <= 0.5;
         if (!extending && range.end < this.duration - 0.05) this.start(range.end);
      } else if (!feed || feed.done || time < feed.from - 0.0005 || time > feed.end + catchUpSeconds) this.start(time);
      this.progress();
   };

   private readonly progress = () => {
      const wake = this.wake;
      this.wake = null;
      wake?.();
   };

   private start(from: number): void {
      this.feed?.controller.abort();
      const feed = { controller: new AbortController(), from, end: from, done: false };
      this.feed = feed;
      this.progress();
      void this.run(feed).catch((error: unknown) => {
         if (feed.controller.signal.aborted || this.disposed) return;
         this.onError(error instanceof Error ? error : new Error(String(error)));
      });
   }

   private async run(feed: NonNullable<PreviewStream["feed"]>): Promise<void> {
      const signal = feed.controller.signal;
      // A restart drops any half-parsed segment from the previous feed.
      if (this.buffer && this.media.readyState === "open") {
         await this.settle(signal);
         // A newer feed owns the buffer once this one is cancelled.
         if (signal.aborted) return;
         this.buffer.abort();
      }
      const response = await fetch(`media://stream/${encodeURIComponent(this.sourceId)}?from=${feed.from.toFixed(6)}&tracks=${this.tracks.join(",")}`, {
         signal,
      });
      if (!response.ok || !response.body) throw new Error((await response.text().catch(() => "")) || "The preview stream could not start.");
      const reader = response.body.getReader();
      signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined), { once: true });
      let head: Uint8Array[] = [];
      for (;;) {
         await this.room(feed);
         if (signal.aborted) return;
         const { done, value } = await reader.read();
         if (signal.aborted) return;
         if (done) {
            feed.done = true;
            await this.settle(signal);
            if (this.feed === feed && this.media.readyState === "open" && feed.end >= this.duration - 1) this.media.endOfStream();
            return;
         }
         let chunk: Uint8Array = value;
         if (!this.buffer) {
            head.push(chunk);
            const joined = concat(head);
            const codec = avcCodec(joined);
            if (!codec) continue;
            head = [];
            chunk = joined;
            this.buffer = this.media.addSourceBuffer(`video/mp4; codecs="${codec}${this.tracks.length ? ",flac" : ""}"`);
            this.buffer.mode = "segments";
         }
         await this.append(chunk, feed);
      }
   }

   /** Resolves once the playhead is close enough to the feed's end to need more. */
   private async room(feed: NonNullable<PreviewStream["feed"]>): Promise<void> {
      for (;;) {
         const video = this.active;
         if (feed.controller.signal.aborted || !video) return;
         const ahead = feed.end - Math.max(video.currentTime, feed.from);
         if (ahead < aheadSeconds * Math.max(1, video.playbackRate)) return;
         await new Promise<void>((resolve) => {
            this.wake = resolve;
            setTimeout(resolve, 1000);
         });
      }
   }

   private settle(signal: AbortSignal): Promise<void> {
      const buffer = this.buffer;
      if (!buffer?.updating) return Promise.resolve();
      return new Promise((resolve) => {
         const finish = () => {
            buffer.removeEventListener("updateend", finish);
            signal.removeEventListener("abort", finish);
            resolve();
         };
         buffer.addEventListener("updateend", finish);
         signal.addEventListener("abort", finish);
      });
   }

   private async append(chunk: Uint8Array, feed: NonNullable<PreviewStream["feed"]>): Promise<void> {
      const signal = feed.controller.signal;
      const buffer = this.buffer!;
      for (let attempt = 0; ; attempt++) {
         await this.settle(signal);
         if (signal.aborted) return;
         await this.evict(signal, attempt > 0);
         if (signal.aborted) return;
         try {
            buffer.appendBuffer(chunk as Uint8Array<ArrayBuffer>);
            break;
         } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "QuotaExceededError" || attempt >= 20) throw error;
            // Full: wait for the playhead to move on, then evict what it left behind.
            await new Promise((resolve) => setTimeout(resolve, 250));
         }
      }
      await this.settle(signal);
      const range = rangeAt(buffer.buffered, Math.max(feed.from, feed.end - 0.001));
      if (range) feed.end = range.end;
   }

   /** Drop media far from the playhead so a long viewing session stays within memory. */
   private async evict(signal: AbortSignal, aggressive: boolean, depth = 0): Promise<void> {
      const buffer = this.buffer;
      const video = this.active;
      if (!buffer || !video || this.media.readyState !== "open" || depth > 8) return;
      const time = video.currentTime;
      const keepFrom = time - (aggressive ? 2 : behindSeconds);
      const keepTo = Math.max(time, this.feed?.end ?? time) + 1;
      const ranges = buffer.buffered;
      for (let index = 0; index < ranges.length; index++) {
         const start = ranges.start(index);
         const end = ranges.end(index);
         const removal: [number, number] | null =
            end <= keepFrom || start >= keepTo
               ? [start, end]
               : start < keepFrom
                 ? [start, keepFrom]
                 : end > keepTo + aheadSeconds * 2
                   ? [keepTo + aheadSeconds * 2, end]
                   : null;
         if (!removal || removal[1] - removal[0] < 0.5) continue;
         buffer.remove(removal[0], removal[1]);
         await this.settle(signal);
         if (signal.aborted) return;
         return this.evict(signal, aggressive, depth + 1);
      }
   }

   dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      this.feed?.controller.abort();
      this.feed = null;
      this.progress();
      this.video?.removeEventListener("seeking", this.seeking);
      this.video?.removeEventListener("timeupdate", this.progress);
      this.video?.removeEventListener("ratechange", this.progress);
      this.video = null;
      URL.revokeObjectURL(this.url);
   }
}
