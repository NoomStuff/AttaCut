import type { DetectedRange, RangeDetection, ScrubAudio, SourceFileStatus } from "../shared/types.ts";
import type { Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { statOrNull } from "./files";
import { keepPrivate } from "./app-log";
import type { Snapshot, SnapshotStore } from "./media/snapshot.ts";
import { resolveFrameTime } from "../shared/frames.ts";
import { packetsAround, sourceFrames, sourceKeyframes, setSourceLifetime } from "./media/probe.ts";
import { SourceProbe } from "./source-probe";
import { frameTimesAround } from "./media/frame-times";
import type { ProbedSource } from "./media/probe.ts";
import { preparePreview, leasePreview, releasePreview } from "./media/preview.ts";
import { streamPreview } from "./media/stream.ts";
import { extractScrubPcm, scrubChunkSeconds } from "./media/scrub-audio.ts";
import { extractWaveform } from "./media/waveform.ts";
import type { WaveformChunk, WaveformResult, WaveformRange } from "./media/waveform-decode.ts";
import { join } from "node:path";
import { detectBlack, detectSceneCuts, detectSilence } from "./media/scenes";

/** The session's hold on a source's snapshot, shared with exports that still read it. */
class Protection {
   copying: AbortController | null = null;
   private leases = 1;
   private releaseSnapshot: (() => void) | null = null;
   private readonly store: SnapshotStore;
   constructor(store: SnapshotStore) {
      this.store = store;
   }
   get active(): boolean {
      return this.leases > 0;
   }
   adopt(snapshot: Snapshot): void {
      this.releaseSnapshot = this.store.retain(snapshot);
   }
   lease(): () => void {
      this.leases++;
      let done = false;
      return () => {
         if (done) return;
         done = true;
         this.drop();
      };
   }
   drop(): void {
      if (--this.leases > 0) return;
      this.copying?.abort();
      this.releaseSnapshot?.();
      this.releaseSnapshot = null;
   }
}

function sameFile(info: Stats, source: ProbedSource): boolean {
   const identity = source.fileIdentity;
   return (
      info.isFile() &&
      info.size === source.size &&
      info.mtimeMs === source.modified &&
      (!identity || (info.dev === identity.device && info.ino === identity.inode))
   );
}

/** Owns the active source. Export plans retain their own immutable source reference. */
export class SourceSession {
   readonly mediaPaths = new Map<string, string>();
   private readonly probe: SourceProbe;
   private readonly previewFolder: string;
   private readonly previewReady: Promise<void>;
   private source: ProbedSource | null = null;
   private keys: Promise<number[]> | null = null;
   private opening = new AbortController();
   private lifetime = new AbortController();
   private preview = new AbortController();
   private previewFiles: string[] = [];
   private previewAudio: number[] | null = null;
   private previewPath: string | null = null;
   private scrub = new AbortController();
   private pcm: { key: string; value: Promise<ScrubAudio | null> } | null = null;
   private detection: { requestId: string; controller: AbortController } | null = null;
   private wave = new AbortController();
   private waveRequest: string | null = null;
   private waveJobs = new Set<Promise<WaveformResult | null>>();
   private waveActivity: ((busy: boolean) => void) | null = null;
   private waveBusy = false;
   private waveRegion: WaveformRange | null = null;
   private waveRegionListener: ((from: number, to: number) => void) | null = null;
   private readonly snapshots: SnapshotStore | null;
   private readonly protections = new WeakMap<ProbedSource, Protection>();
   private watcher: ReturnType<typeof setInterval> | null = null;
   private fileStatus: SourceFileStatus | null = null;
   private checking = false;
   private readonly onFileStatus: (status: SourceFileStatus) => void;
   constructor(
      previewFolder: string,
      previewReady: Promise<void> = Promise.resolve(),
      probe = new SourceProbe(),
      files: { snapshots?: SnapshotStore; onStatus?: (status: SourceFileStatus) => void } = {}
   ) {
      this.previewFolder = previewFolder;
      this.previewReady = previewReady;
      this.probe = probe;
      this.snapshots = files.snapshots ?? null;
      this.onFileStatus = files.onStatus ?? (() => undefined);
   }
   get signal(): AbortSignal {
      return this.lifetime.signal;
   }
   get current(): ProbedSource | null {
      return this.source;
   }
   get(id: string): ProbedSource {
      if (!this.source || this.source.id !== id) throw new Error("Reopen the source video.");
      return this.source;
   }
   cancelOpening(): void {
      this.opening.abort();
   }
   async open(path: string, validate?: (source: ProbedSource) => void | Promise<void>): Promise<ProbedSource> {
      this.opening.abort();
      const controller = new AbortController();
      this.opening = controller;
      const source = await this.probe.open(path, controller.signal);
      controller.signal.throwIfAborted();
      await validate?.(source);
      controller.signal.throwIfAborted();
      this.release();
      this.source = source;
      setSourceLifetime(source, this.signal);
      this.mediaPaths.set(source.id, source.path);
      await this.protect(source);
      this.watch(source);
      // Warm what the first seek needs: the in-memory frame index for MP4-family sources,
      // the first small packet window for everything else.
      if ([".mp4", ".m4v", ".mov"].includes(source.extension.toLowerCase())) void sourceFrames(source, this.signal).catch(() => undefined);
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
   async frameTime(id: string, time: number, direction: -1 | 0 | 1): Promise<number> {
      const source = this.get(id);
      const signal = this.signal;
      const points = await frameTimesAround(source, time, signal);
      signal.throwIfAborted();
      return resolveFrameTime(points, time, source.duration, direction);
   }
   async frameTimes(id: string, times: number[]): Promise<number[]> {
      const source = this.get(id);
      const signal = this.signal;
      const frames = await sourceFrames(source, signal).catch(() => null);
      signal.throwIfAborted();
      if (frames) return times.map((time) => resolveFrameTime(frames, time, source.duration));
      return Promise.all(
         times.map(async (time) => {
            const points = await frameTimesAround(source, time, signal);
            signal.throwIfAborted();
            return resolveFrameTime(points, time, source.duration);
         })
      );
   }
   async autoDetectCuts(id: string, requestId: string, threshold: number): Promise<number[]> {
      const source = this.get(id);
      return this.scan(requestId, (signal) => detectSceneCuts(source, threshold, signal));
   }
   /** Removal ranges land on the nearest source frames, like any committed boundary. */
   async detectRanges(id: string, requestId: string, detection: RangeDetection): Promise<DetectedRange[]> {
      const source = this.get(id);
      return this.scan(requestId, async (signal) => {
         const ranges =
            detection.kind === "silence"
               ? await detectSilence(source, detection.audioIndex, detection.noise, detection.minimum, signal)
               : await detectBlack(source, detection.minimum, signal);
         if (!ranges.length) return ranges;
         const [first = 0, ...times] = await this.frameTimes(id, [0, ...ranges.flatMap((range) => [range.start, range.end])]);
         signal.throwIfAborted();
         const snapped: DetectedRange[] = [];
         for (let index = 0; index < ranges.length; index++) {
            // A range that starts on the first picture also covers the lead-in before it.
            const start = times[index * 2]! <= first ? 0 : times[index * 2]!;
            const end = times[index * 2 + 1]!;
            if (end <= start) continue;
            const last = snapped.at(-1);
            if (last && start <= last.end) last.end = Math.max(last.end, end);
            else snapped.push({ start, end });
         }
         return snapped;
      });
   }
   /** Scene and range scans share one slot: a new scan replaces the previous one. */
   private async scan<T>(requestId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
      this.detection?.controller.abort();
      const scan = { requestId, controller: new AbortController() };
      this.detection = scan;
      try {
         return await run(AbortSignal.any([this.signal, scan.controller.signal]));
      } finally {
         if (this.detection === scan) this.detection = null;
      }
   }
   cancelDetection(requestId: string): void {
      if (this.detection?.requestId === requestId) this.detection.controller.abort();
   }
   cancelPreview(): void {
      this.preview.abort();
   }
   async prepare(id: string, tracks: number[], transcode: boolean): Promise<string> {
      const source = this.get(id);
      this.cancelPreview();
      this.cancelWaveform();
      const controller = new AbortController();
      this.preview = controller;
      await this.previewReady;
      controller.signal.throwIfAborted();
      const result = await preparePreview(source, this.previewFolder, tracks, transcode, { signal: controller.signal });
      controller.signal.throwIfAborted();
      this.previewAudio = [...tracks].sort((a, b) => a - b);
      this.previewPath = result.path;
      this.mediaPaths.set(result.id, result.path);
      if (!this.previewFiles.includes(result.path)) {
         this.previewFiles.push(result.path);
         leasePreview(result.path);
      }
      while (this.previewFiles.length > 2) {
         const old = this.previewFiles.shift()!;
         for (const [key, path] of this.mediaPaths) if (path === old) this.mediaPaths.delete(key);
         releasePreview(old);
      }
      return `media://source/${result.id}`;
   }
   /** A playable stream from `from` onward. It ends with the request or the source. */
   stream(id: string, tracks: number[], from: number, request: AbortSignal): Promise<ReadableStream<Uint8Array>> {
      const source = this.get(id);
      if (!Number.isFinite(from) || from < 0 || from > source.duration) throw new Error("Choose a time inside the video.");
      if (tracks.some((track) => !source.streams.some((stream) => stream.type === "audio" && stream.index === track)))
         throw new Error("Audio track not found.");
      return streamPreview(source, tracks, from, AbortSignal.any([request, this.signal]));
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
         if (this.pcm?.value === value) this.pcm = null;
         throw error;
      });
      this.pcm = { key, value };
      return value;
   }
   cancelWaveform(requestId?: string): void {
      if (!requestId || requestId === this.waveRequest) this.wave.abort();
   }
   /** The file a waveform should decode: the prepared preview when it carries exactly the
       requested tracks (it is compact and indexed), otherwise the source itself. */
   waveformDecodePath(tracks: number[]): string | undefined {
      if (!this.previewAudio || !this.previewPath) return undefined;
      const wanted = [...tracks].sort((a, b) => a - b);
      if (wanted.length !== this.previewAudio.length || wanted.some((track, index) => track !== this.previewAudio![index])) return undefined;
      return this.previewPath;
   }
   /** One extraction at a time; `onChunk` streams completed peak ranges. */
   startWaveform(
      id: string,
      requestId: string,
      tracks: number[],
      decodePath: string | undefined,
      onChunk: (chunk: WaveformChunk) => void
   ): Promise<WaveformResult | null> {
      const source = this.get(id);
      this.cancelWaveform();
      this.wave = new AbortController();
      this.waveRequest = requestId;
      this.waveBusy = false;
      this.waveRegion = null;
      const signal = this.wave.signal;
      const pending = extractWaveform(
         source,
         tracks,
         signal,
         (chunk) => {
            if (!signal.aborted) onChunk(chunk);
         },
         {
            folder: join(this.previewFolder, "..", "waveforms"),
            ...(decodePath ? { decodePath } : {}),
            activity: (listener) => {
               this.waveActivity = listener;
               listener(this.waveBusy);
               return () => {
                  if (this.waveActivity === listener) this.waveActivity = null;
               };
            },
            region: (listener) => {
               this.waveRegionListener = listener;
               if (this.waveRegion) listener(this.waveRegion.from, this.waveRegion.to);
               return () => {
                  if (this.waveRegionListener === listener) this.waveRegionListener = null;
               };
            },
         }
      );
      this.waveJobs.add(pending);
      const finished = () => {
         this.waveJobs.delete(pending);
      };
      void pending.then(finished, finished);
      return pending;
   }
   waveformRegion(requestId: string, from: number, to: number): void {
      if (requestId !== this.waveRequest) return;
      this.waveRegion = { from, to };
      this.waveRegionListener?.(from, to);
   }
   waveformActivity(requestId: string, busy: boolean): void {
      if (requestId !== this.waveRequest) return;
      this.waveBusy = busy;
      this.waveActivity?.(busy);
   }
   async waitForWaveformIdle(): Promise<void> {
      await Promise.allSettled([...this.waveJobs]);
   }
   /** Exports keep reading a source after the editor closes it; this keeps its snapshot until they finish. */
   retainMedia(source: ProbedSource): () => void {
      const protection = this.protections.get(source);
      return protection?.active ? protection.lease() : () => undefined;
   }
   get status(): SourceFileStatus | null {
      return this.fileStatus;
   }
   /** Point the session at the original after it moved. Only a file with the same contents is accepted. */
   async locate(id: string, path: string): Promise<SourceFileStatus> {
      const source = this.get(id);
      const info = await stat(path);
      if (extname(path).toLowerCase() !== source.extension.toLowerCase()) throw new Error(`Choose the original ${source.extension} file.`);
      if (!info.isFile() || info.size !== source.size || info.mtimeMs !== source.modified)
         throw new Error("That's a different file from the one you're editing. Choose the original video.");
      this.follow(source, path, info);
      return this.report(source, "present");
   }
   private async protect(source: ProbedSource): Promise<void> {
      if (!this.snapshots) return;
      const store = this.snapshots;
      const protection = new Protection(store);
      this.protections.set(source, protection);
      const original = await statOrNull(source.path).catch(() => null);
      if (!original || !sameFile(original, source)) return;
      const instant = await store.instant(source.path, original).catch(() => null);
      if (instant) {
         this.adopt(source, protection, instant);
         return;
      }
      const copying = new AbortController();
      protection.copying = copying;
      void store
         .copy(source.path, original, copying.signal)
         .then((snapshot) => {
            if (!snapshot) return;
            if (!protection.active) {
               store.retain(snapshot)();
               return;
            }
            this.adopt(source, protection, snapshot);
            if (this.source === source) this.report(source, this.fileStatus?.state ?? "present");
         })
         .catch(() => undefined)
         .finally(() => {
            if (protection.copying === copying) protection.copying = null;
         });
   }
   private adopt(source: ProbedSource, protection: Protection, snapshot: Snapshot): void {
      protection.adopt(snapshot);
      source.media = { path: snapshot.path, device: snapshot.device, inode: snapshot.inode, modified: snapshot.modified, kind: snapshot.kind };
      if (this.mediaPaths.has(source.id)) this.mediaPaths.set(source.id, snapshot.path);
   }
   private watch(source: ProbedSource): void {
      this.report(source, "present", false);
      this.watcher = setInterval(() => void this.check(source), 2000);
      this.watcher.unref?.();
   }
   private async check(source: ProbedSource): Promise<void> {
      if (this.checking || this.source !== source) return;
      this.checking = true;
      try {
         const info = await statOrNull(source.path).catch(() => null);
         if (this.source !== source) return;
         if (info && sameFile(info, source)) {
            if (this.fileStatus?.state !== "present") this.report(source, "present");
            return;
         }
         if (this.fileStatus?.state !== "present") return;
         const renamed = await this.findRenamed(source);
         if (this.source !== source) return;
         if (renamed) {
            this.follow(source, renamed.path, renamed.info);
            this.report(source, "present");
         } else this.report(source, info ? "changed" : "missing");
      } finally {
         this.checking = false;
      }
   }
   /** A rename inside the same folder keeps the file's identity, so the edit follows it. */
   private async findRenamed(source: ProbedSource): Promise<{ path: string; info: Stats } | null> {
      if (!source.fileIdentity) return null;
      const names = await readdir(source.directory).catch(() => [] as string[]);
      for (const name of names) {
         if (extname(name).toLowerCase() !== source.extension.toLowerCase()) continue;
         const path = join(source.directory, name);
         const info = await stat(path).catch(() => null);
         if (info && sameFile(info, source)) return { path, info };
      }
      return null;
   }
   private follow(source: ProbedSource, path: string, info: Stats): void {
      keepPrivate(path, "video");
      source.path = path;
      source.name = basename(path);
      source.directory = dirname(path);
      source.fileIdentity = { device: info.dev, inode: info.ino };
      if (!source.media) this.mediaPaths.set(source.id, path);
   }
   private report(source: ProbedSource, state: SourceFileStatus["state"], emit = true): SourceFileStatus {
      const status: SourceFileStatus = {
         sourceId: source.id,
         state,
         path: source.path,
         name: source.name,
         directory: source.directory,
         protected: !!source.media && source.media.kind !== "original",
      };
      this.fileStatus = status;
      if (emit) this.onFileStatus(status);
      return status;
   }
   private release(): void {
      if (this.watcher) clearInterval(this.watcher);
      this.watcher = null;
      this.fileStatus = null;
      if (this.source) this.protections.get(this.source)?.drop();
      this.lifetime.abort();
      this.lifetime = new AbortController();
      this.cancelPreview();
      this.cancelScrub();
      this.cancelWaveform();
      this.previewAudio = null;
      this.previewPath = null;
      this.keys = null;
      this.source = null;
      this.mediaPaths.clear();
      for (const path of this.previewFiles) releasePreview(path);
      this.previewFiles = [];
   }
   close(): void {
      this.opening.abort();
      this.probe.cancelPrefetch();
      this.release();
   }
   /** Close for good: the fresh lifetime release() leaves behind is aborted too. */
   dispose(): void {
      this.close();
      this.lifetime.abort();
   }
}
