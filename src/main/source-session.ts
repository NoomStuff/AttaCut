import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { ScrubAudio } from "../shared/types.ts";
import { packetsAround, probeSource, sourceFrames, sourceKeyframes } from "./media/probe.ts";
import type { ProbedSource } from "./media/probe.ts";
import { preparePreview } from "./media/preview.ts";
import { extractScrubPcm, scrubChunkSeconds } from "./media/scrub-audio.ts";

async function removePreview(path: string): Promise<void> {
   // Chromium can hold the old file briefly while the renderer adopts its new URL.
   for (let attempt = 0; attempt < 6; attempt++) {
      try {
         await rm(path, { force: true });
         return;
      } catch {
         await delay(200);
      }
   }
   // Startup also clears the private cache, including files locked by an interrupted run.
}

/** Owns the active source. Export plans retain their own immutable source reference. */
export class SourceSession {
   private opening = new AbortController();
   private lifetime = new AbortController();
   private preview = new AbortController();
   private scrub = new AbortController();
   private source: ProbedSource | null = null;
   private keys: Promise<number[]> | null = null;
   private pcm: { key: string; value: Promise<ScrubAudio | null> } | null = null;
   private previewFiles: string[] = [];
   readonly mediaPaths = new Map<string, string>();
   constructor(
      private previewFolder: string,
      private previewReady: Promise<void> = Promise.resolve()
   ) {}
   get signal(): AbortSignal {
      return this.lifetime.signal;
   }
   get(id: string): ProbedSource {
      if (!this.source || this.source.id !== id) throw new Error("Reopen the source video.");
      return this.source;
   }
   async open(path: string): Promise<ProbedSource> {
      this.opening.abort();
      const controller = new AbortController();
      this.opening = controller;
      const source = await probeSource(path, controller.signal);
      controller.signal.throwIfAborted();
      this.release();
      this.source = source;
      this.mediaPaths.set(source.id, source.path);
      // Warm what the first seek needs: the in-memory frame index for MP4-family sources,
      // the first small packet window for everything else.
      if ([".mp4", ".m4v", ".mov"].includes(source.extension)) void sourceFrames(source, this.signal).catch(() => undefined);
      else void packetsAround(source, 0, this.signal, "seek").catch(() => undefined);
      return source;
   }
   keyframes(id: string): Promise<number[]> {
      const source = this.get(id);
      if (!this.keys)
         this.keys = sourceKeyframes(source, this.signal).catch((error: unknown) => {
            if (this.source === source) this.keys = null;
            throw error;
         });
      return this.keys;
   }
   cancelPreview(): void {
      this.preview.abort();
   }
   async prepare(id: string, tracks: number[], transcode: boolean): Promise<string> {
      const source = this.get(id);
      this.cancelPreview();
      const controller = new AbortController();
      this.preview = controller;
      await this.previewReady;
      controller.signal.throwIfAborted();
      const result = await preparePreview(source, this.previewFolder, tracks, transcode, { signal: controller.signal });
      controller.signal.throwIfAborted();
      this.mediaPaths.set(result.id, result.path);
      if (!this.previewFiles.includes(result.path)) this.previewFiles.push(result.path);
      while (this.previewFiles.length > 2) {
         const old = this.previewFiles.shift()!;
         for (const [key, path] of this.mediaPaths) if (path === old) this.mediaPaths.delete(key);
         void removePreview(old);
      }
      return `media://source/${result.id}`;
   }
   cancelScrub(): void {
      this.scrub.abort();
      this.pcm = null;
   }
   scrubAudio(id: string, tracks: number[], time: number): Promise<ScrubAudio | null> {
      const source = this.get(id);
      const start = Math.floor(Math.max(0, Math.min(time, source.duration)) / scrubChunkSeconds) * scrubChunkSeconds;
      const key = `${id}:${tracks.join(",")}:${start}`;
      if (this.pcm?.key === key) return this.pcm.value;
      this.cancelScrub();
      this.scrub = new AbortController();
      const value = extractScrubPcm(source, tracks, this.scrub.signal, start).catch((error: unknown) => {
         if (this.pcm?.key === key) this.pcm = null;
         throw error;
      });
      this.pcm = { key, value };
      return value;
   }
   private release(): void {
      this.lifetime.abort();
      this.lifetime = new AbortController();
      this.cancelPreview();
      this.cancelScrub();
      this.keys = null;
      this.source = null;
      this.mediaPaths.clear();
      for (const path of this.previewFiles.splice(0)) void removePreview(path);
   }
   dispose(): void {
      this.opening.abort();
      this.release();
      this.lifetime.abort();
   }
}
