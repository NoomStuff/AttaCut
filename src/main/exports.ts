import { audioStreams } from "../shared/media";
import type { ContainerChoice } from "../shared/export-format";
import type { ChapterMark } from "./media/mux.ts";
import { randomUUID } from "node:crypto";
import { access, constants, mkdir } from "node:fs/promises";
import { statOrNull } from "./files";
import { join, resolve } from "node:path";
import type {
   AnalyzeRequest,
   Clip,
   DestinationConflict,
   ExportApproval,
   ExportDestinations,
   ExportJob,
   ExportPlan,
   PlanRequest,
   CutReport,
   ExportStage,
} from "../shared/types.ts";
import { analyzeRequestSchema, exportExtensionFor, planRequestSchema } from "../shared/types.ts";
import { analyzeCut, exportCut } from "./media/cut.ts";
import type { CutAnalysis } from "./media/cut.ts";
import type { ProbedSource } from "./media/probe.ts";
import { protectSource } from "./media/publish.ts";
import { exportCombined } from "./media/combine.ts";
import { duplicateNames, filenameError } from "../shared/filename";
import { substantialEncoding } from "../shared/export-policy";
import { waitForWork } from "./media/shared-work";
import { appFailure } from "./failure";
import { recordDiagnostic } from "./diagnostics";

/** Everything about an export's output except its clips and destination. */
interface OutputSettings {
   audioTracks: number[];
   excludedStreams: number[];
   lossless: boolean;
   container: ContainerChoice;
}
interface StoredPlan {
   plan: ExportPlan;
   source: ProbedSource;
   analyses: Map<string, CutAnalysis[]>;
   output: OutputSettings;
   chapters: ChapterMark[] | undefined;
   approval?: ExportApproval;
}
export class ExportService {
   private plans = new Map<string, StoredPlan>();
   private analyses = new Map<string, Promise<CutAnalysis>>();
   private analysisController = new AbortController();
   private inspectionController = new AbortController();
   private controller: AbortController | null = null;
   private job: ExportJob | null = null;
   private runningPlan: StoredPlan | null = null;
   private completion: Promise<void> = Promise.resolve();
   private readonly emit: (job: ExportJob) => void;
   private readonly beforeItem: ((signal: AbortSignal) => Promise<void>) | undefined;
   constructor(emit: (job: ExportJob) => void, beforeItem?: (signal: AbortSignal) => Promise<void>) {
      this.emit = emit;
      this.beforeItem = beforeItem;
   }
   cancelAnalysis(): void {
      this.inspectionController.abort();
      this.inspectionController = new AbortController();
   }
   /** Drop every plan and cached analysis; they describe a source that is no longer open. */
   cancelPlanning(): void {
      this.cancelAnalysis();
      this.analysisController.abort();
      this.analysisController = new AbortController();
      this.analyses.clear();
      this.plans.clear();
   }
   get running(): boolean {
      return this.job?.running ?? false;
   }
   get current(): ExportJob | null {
      return this.job;
   }
   private async cut(
      source: ProbedSource,
      clip: Clip,
      output: OutputSettings,
      extension: string,
      mode: "separate" | "combined",
      signal: AbortSignal
   ): Promise<CutAnalysis> {
      signal.throwIfAborted();
      const { audioTracks, excludedStreams, lossless } = output;
      const key = JSON.stringify([source.id, source.size, source.modified, clip.start, clip.end, audioTracks, excludedStreams, lossless, extension, mode]);
      let pending = this.analyses.get(key);
      if (!pending) {
         pending = analyzeCut(source, clip, signal, {
            audioTracks,
            excludedStreams,
            lossless,
            extension,
            combined: mode === "combined",
         }).catch((error: unknown) => {
            if (this.analyses.get(key) === pending) this.analyses.delete(key);
            throw error;
         });
         if (this.analyses.size >= 500) this.analyses.delete(this.analyses.keys().next().value!);
         this.analyses.set(key, pending);
      }
      const cached = await pending;
      return { ...cached, clip: { ...cached.clip, id: clip.id, color: clip.color } };
   }
   private async analyze(source: ProbedSource, request: AnalyzeRequest, signal = this.analysisController.signal): Promise<CutAnalysis[]> {
      const settings = analyzeRequestSchema.parse(request);
      const output = outputSettings(source, settings);
      const sorted = settings.items.map((item) => ({ ...item.clip })).sort((a, b) => a.start - b.start);
      const clips: Clip[] = [];
      for (const clip of sorted) {
         const previous = clips.at(-1);
         // Only remove shared boundaries. Even a small gap is selected content to omit.
         if (settings.mode === "combined" && previous?.end === clip.start) previous.end = clip.end;
         else clips.push(clip);
      }
      const results = await mapConcurrent(
         clips,
         (clip) => {
            const extension = exportExtensionFor(source, clip, {
               separate: settings.mode === "separate",
               unchanged: unchangedOutput(source, output),
               container: output.container,
            });
            return this.cut(source, clip, output, extension, settings.mode, signal);
         },
         2
      );
      signal.throwIfAborted();
      return results;
   }
   async inspect(source: ProbedSource, request: AnalyzeRequest): Promise<CutReport[]> {
      const work = this.analyze(source, request);
      return (await waitForWork(work, this.inspectionController.signal)).map(({ clip, method, encodedSeconds, message, changes, streams }) => ({
         clip,
         method,
         encodedSeconds,
         message,
         ...(changes ? { changes } : {}),
         ...(streams ? { streams } : {}),
      }));
   }
   /** Per-item destination conflicts; the renderer never reconstructs export naming itself. */
   async checkDestinations(source: ProbedSource, request: PlanRequest): Promise<ExportDestinations> {
      const settings = planRequestSchema.parse(request);
      const directoryPath = resolve(settings.directory);
      const names = outputNames(source, settings);
      const conflictFor = async (path: string): Promise<Omit<DestinationConflict, "clipId">> => {
         if (await protectSource(source.path, path, true)) return { conflict: "Will replace the source video", danger: true };
         return (await exists(path)) ? { conflict: "Will replace an existing file", danger: false } : { conflict: null, danger: false };
      };
      if (settings.mode === "combined") return { items: [{ clipId: null, ...(await conflictFor(join(directoryPath, names[0]!))) }] };
      const sorted = [...settings.items].sort((a, b) => a.clip.start - b.clip.start);
      const items = await mapConcurrent(sorted, (item, index) =>
         conflictFor(join(directoryPath, names[index]!)).then((conflict) => ({ clipId: item.clip.id, ...conflict }))
      );
      return { items };
   }
   async plan(source: ProbedSource, request: PlanRequest): Promise<ExportPlan> {
      const settings = planRequestSchema.parse(request);
      const signal = this.analysisController.signal;
      const output = outputSettings(source, settings);
      const directoryPath = resolve(settings.directory);
      const directory = await statOrNull(directoryPath).catch((error: Error) => {
         throw new Error(`Cannot access the output folder: ${error.message}`);
      });
      if (directory && !directory.isDirectory()) throw new Error("Choose an output folder, not a file.");
      if (directory) await access(directoryPath, constants.W_OK);
      const names = outputNames(source, settings);
      const itemNames = settings.mode === "combined" ? outputNames(source, { ...settings, mode: "separate" }) : names;
      // The panel blocks collisions live; planning also rejects stale or direct IPC requests.
      if (settings.mode === "separate" && duplicateNames(names).size) throw new Error("Some clips export to the same file name. Give each clip its own name.");
      const cuts = await this.analyze(source, settings, signal);
      const chapters = settings.mode === "combined" && settings.clipChapters ? clipChapters(settings.items, cuts) : undefined;
      const analyses = new Map<string, CutAnalysis[]>();
      const items = [];
      for (const [index, analysis] of cuts.entries()) {
         const name = itemNames[index]!;
         const id = randomUUID();
         analyses.set(id, [analysis]);
         items.push({
            id,
            clip: analysis.clip,
            outputPath: join(directoryPath, name),
            name,
            method: analysis.method,
            encodedSeconds: analysis.encodedSeconds,
            message: analysis.message,
            changes: analysis.changes ?? [],
            streams: analysis.streams ?? [],
            duration: analysis.clip.end - analysis.clip.start,
         });
      }
      if (settings.mode === "combined") {
         const name = names[0]!;
         const first = items[0]!;
         const unsupported = cuts.filter((cut) => cut.method === "unsupported");
         const combined = {
            ...first,
            name,
            outputPath: join(directoryPath, name),
            method: unsupported.length ? ("unsupported" as const) : cuts.some((cut) => cut.method === "boundary") ? ("boundary" as const) : ("copy" as const),
            message: [...new Set(cuts.map((cut) => cut.message))].join(" "),
            changes: [...new Set(cuts.flatMap((cut) => cut.changes ?? []))],
            streams: cuts
               .flatMap((cut) => cut.streams ?? [])
               .filter((stream, index, all) => all.findIndex((item) => item.index === stream.index && item.action === stream.action) === index),
            duration: cuts.reduce((sum, cut) => sum + cut.clip.end - cut.clip.start, 0),
            encodedSeconds: cuts.reduce((sum, cut) => sum + cut.encodedSeconds, 0),
         };
         analyses.clear();
         analyses.set(first.id, cuts);
         items.splice(0, items.length, combined);
      }
      const destinations = await mapConcurrent(items, async (item) => ({
         source: await protectSource(source.path, item.outputPath, true),
         exists: await exists(item.outputPath),
      }));
      let sourcePath: string | null = null;
      const existingPaths: string[] = [];
      items.forEach((item, index) => {
         if (destinations[index]!.source) sourcePath = item.outputPath;
         if (destinations[index]!.exists) existingPaths.push(item.outputPath);
      });
      const plan: ExportPlan = {
         id: randomUUID(),
         sourceId: source.id,
         directory: directoryPath,
         items,
         mode: settings.mode,
         directoryMissing: !directory,
         existingPaths,
         sourcePath,
      };
      signal.throwIfAborted();
      if (this.plans.size >= 20) this.plans.delete(this.plans.keys().next().value!);
      this.plans.set(plan.id, { plan, source, analyses, output, chapters });
      return plan;
   }
   start(planId: string, approval: ExportApproval = {}): ExportJob {
      if (this.running) throw new Error("An export is already running.");
      const stored = this.plans.get(planId);
      if (!stored) throw new Error("The export plan expired. Review the clips again.");
      if (stored.plan.directoryMissing && !approval.createDirectory) throw new Error("Confirm creating the output folder before exporting.");
      if (stored.plan.existingPaths.length && !approval.overwrite) throw new Error("Confirm replacing the existing files before exporting.");
      if (stored.plan.sourcePath && !approval.replaceSource) throw new Error("Confirm replacing the source video before exporting.");
      if (stored.plan.items.some((item) => item.changes?.length) && !approval.mediaChanges)
         throw new Error("Confirm the changes to preserved media before exporting.");
      if (stored.plan.items.some(substantialEncoding) && !approval.substantialEncoding)
         throw new Error("Confirm re-encoding a substantial part of the video before exporting.");
      if (stored.plan.items.some((item) => item.method === "unsupported")) throw new Error("Some clips cannot be exported with these boundaries.");
      this.runningPlan = stored;
      stored.approval = approval;
      this.job = {
         id: randomUUID(),
         sourceId: stored.source.id,
         replacesSource: !!stored.plan.sourcePath,
         directory: stored.plan.directory,
         running: true,
         items: stored.plan.items.map((item) => ({
            id: item.id,
            name: item.name,
            outputPath: item.outputPath,
            status: "queued",
            progress: 0,
            duration: item.duration ?? item.clip.end - item.clip.start,
            // Combined outputs span many cuts, so a source range would mislabel them.
            ...(stored.plan.mode === "separate" ? { start: item.clip.start, end: item.clip.end } : {}),
            error: null,
         })),
      };
      this.controller = new AbortController();
      this.completion = this.run();
      return structuredClone(this.job);
   }
   cancel(): void {
      this.controller?.abort();
   }
   waitForIdle(): Promise<void> {
      return this.completion;
   }
   retry(jobId: string): ExportJob {
      if (!this.job || this.job.id !== jobId || this.running) throw new Error("This export cannot be retried now.");
      if (!this.job.items.some((item) => item.status !== "completed" && item.failure?.retryable !== false))
         throw new Error("Change the cuts or options before exporting these files again.");
      for (const item of this.job.items)
         if (item.status !== "completed" && item.failure?.retryable !== false) {
            item.status = "queued";
            item.error = null;
            item.progress = 0;
            delete item.failure;
            delete item.stage;
         }
      this.job.running = true;
      this.controller = new AbortController();
      this.completion = this.run();
      return structuredClone(this.job);
   }
   private async run(): Promise<void> {
      const job = this.job!;
      const stored = this.runningPlan!;
      const signal = this.controller!.signal;
      for (const item of job.items) {
         if (item.status !== "queued") continue;
         if (signal.aborted) {
            item.status = "cancelled";
            continue;
         }
         item.status = "running";
         let recordedStage: ExportStage | undefined;
         let stageStarted = performance.now();
         const finishStage = (outcome: "ok" | ReturnType<typeof appFailure>["code"] = "ok") => {
            if (recordedStage) recordDiagnostic("export:stage", performance.now() - stageStarted, outcome, recordedStage);
         };
         this.emit(structuredClone(job));
         try {
            await this.beforeItem?.(signal);
            signal.throwIfAborted();
            if (stored.approval?.createDirectory) await mkdir(stored.plan.directory, { recursive: true });
            await protectSource(stored.source.path, item.outputPath, !!stored.approval?.replaceSource && item.outputPath === stored.plan.sourcePath);
            const cuts = stored.analyses.get(item.id)!;
            const options = {
               priority: "export" as const,
               onStage: (stage: ExportStage) => {
                  if (stage === recordedStage) return;
                  finishStage();
                  recordedStage = stage;
                  stageStarted = performance.now();
                  item.stage = stage;
                  this.emit(structuredClone(job));
               },
               signal,
               audioTracks: stored.output.audioTracks,
               excludedStreams: stored.output.excludedStreams,
               lossless: stored.output.lossless,
               ...(stored.chapters ? { chapters: stored.chapters } : {}),
               overwrite: !!stored.approval?.overwrite && stored.plan.existingPaths.includes(item.outputPath),
               replaceSource: !!stored.approval?.replaceSource && item.outputPath === stored.plan.sourcePath,
               onProgress: (value: number) => {
                  item.progress = Math.max(item.progress, Math.min(0.99, value));
                  this.emit(structuredClone(job));
               },
            };
            if (stored.plan.mode === "combined" && cuts.length > 1) await exportCombined(stored.source, cuts, item.outputPath, options);
            else await exportCut(stored.source, cuts[0]!, item.outputPath, options);
            item.status = "completed";
            item.progress = 1;
         } catch (error) {
            item.status = signal.aborted ? "cancelled" : "failed";
            item.error = error instanceof Error ? error.message : String(error);
            item.failure = appFailure(error);
         }
         finishStage(item.status === "cancelled" ? "cancelled" : (item.failure?.code ?? "ok"));
         this.emit(structuredClone(job));
      }
      job.running = false;
      this.emit(structuredClone(job));
   }
}
function outputSettings(source: ProbedSource, settings: ReturnType<typeof analyzeRequestSchema.parse>): OutputSettings {
   const optional = (stream: ProbedSource["streams"][number]) =>
      ["subtitle", "data", "attachment"].includes(stream.type) || (stream.type === "video" && stream.attachedPicture);
   const excludedStreams = [...new Set(settings.excludedStreams)].sort((a, b) => a - b);
   if (excludedStreams.some((index) => !source.streams.some((stream) => stream.index === index && optional(stream))))
      throw new Error("One or more turned off tracks were not found.");
   return {
      audioTracks: exportAudioTracks(source, settings.audioTracks),
      excludedStreams,
      lossless: settings.lossless,
      container: settings.container,
   };
}
function unchangedOutput(source: ProbedSource, output: OutputSettings): boolean {
   return output.audioTracks.length === audioStreams(source).length && !output.excludedStreams.length;
}
/**
 * One chapter per selected clip on the joined timeline. Adjacent clips join into one cut, so
 * each clip is located inside the cut that contains it and offset by the cuts before it.
 */
export function clipChapters(items: { clip: Clip; name: string }[], cuts: Pick<CutAnalysis, "clip">[]): ChapterMark[] {
   const offsets: number[] = [];
   const total = cuts.reduce((sum, cut, index) => {
      offsets[index] = sum;
      return sum + cut.clip.end - cut.clip.start;
   }, 0);
   return [...items]
      .sort((a, b) => a.clip.start - b.clip.start)
      .flatMap((item) => {
         const index = cuts.findIndex((cut) => item.clip.start < cut.clip.end && item.clip.end > cut.clip.start);
         const cut = cuts[index];
         if (!cut) return [];
         const length = cut.clip.end - cut.clip.start;
         const start = offsets[index]! + Math.min(length, Math.max(0, item.clip.start - cut.clip.start));
         const end = offsets[index]! + Math.min(length, Math.max(0, item.clip.end - cut.clip.start));
         return end > start ? [{ start, end, title: item.name }] : [];
      })
      .map((chapter, index, all) => {
         // Snapped boundaries can leave slivers between neighbours; chapters tile the output.
         const next = all[index + 1];
         return { ...chapter, start: index === 0 ? 0 : chapter.start, end: next ? next.start : total };
      });
}
function exportAudioTracks(source: ProbedSource, selected: number[] | null): number[] {
   const available = audioStreams(source).map((stream) => stream.index);
   const tracks = selected ?? available;
   if (new Set(tracks).size !== tracks.length || tracks.some((index) => !available.includes(index)))
      throw new Error("One or more selected audio tracks were not found.");
   return tracks;
}
function outputNames(source: ProbedSource, request: ReturnType<typeof planRequestSchema.parse>): string[] {
   const outputName = (value: string, extension: string): string => {
      const error = filenameError(value, extension);
      if (error) throw new Error(error);
      return value.toLowerCase().endsWith(extension.toLowerCase()) ? value : `${value}${extension}`;
   };
   if (request.mode === "combined") {
      const extension = request.container === "auto" ? source.exportExtension : request.container;
      return [outputName(request.name, extension)];
   }
   const unchanged = unchangedOutput(source, outputSettings(source, request));
   return [...request.items]
      .sort((a, b) => a.clip.start - b.clip.start)
      .map((item) => {
         const extension = exportExtensionFor(source, item.clip, { separate: true, unchanged, container: request.container });
         return outputName(item.name, extension);
      });
}
async function exists(path: string): Promise<boolean> {
   return (await statOrNull(path)) !== null;
}
/** Keep large clip batches from issuing hundreds of filesystem requests at once. */
async function mapConcurrent<T, R>(items: T[], visit: (item: T, index: number) => Promise<R>, concurrency = 16): Promise<R[]> {
   const results = new Array<R>(items.length);
   let next = 0;
   await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, async () => {
         while (next < items.length) {
            const index = next++;
            results[index] = await visit(items[index]!, index);
         }
      })
   );
   return results;
}
