import { randomUUID } from "node:crypto";
import { access, constants, mkdir, stat } from "node:fs/promises";
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
import { sanitizeName } from "../shared/filename";
import { substantialEncoding } from "../shared/export-policy";
import { waitForWork } from "./media/shared-work";
import { appFailure } from "./failure";
import { recordDiagnostic } from "./diagnostics";

interface StoredPlan {
   plan: ExportPlan;
   source: ProbedSource;
   analyses: Map<string, CutAnalysis[]>;
   audioTracks: number[];
   approval?: ExportApproval;
}
export class ExportService {
   private plans = new Map<string, StoredPlan>();
   private analysisController = new AbortController();
   private inspectionController = new AbortController();
   cancelAnalysis(): void {
      this.inspectionController.abort();
      this.inspectionController = new AbortController();
   }
   private analyses = new Map<string, Promise<CutAnalysis>>();
   cancelPlanning(): void {
      this.cancelAnalysis();
      this.analysisController.abort();
      this.analysisController = new AbortController();
      this.analyses.clear();
      this.plans.clear();
   }
   private controller: AbortController | null = null;
   private job: ExportJob | null = null;
   private runningPlan: StoredPlan | null = null;
   private completion: Promise<void> = Promise.resolve();
   private emit: (job: ExportJob) => void;
   private readonly beforeItem: ((signal: AbortSignal) => Promise<void>) | undefined;
   constructor(emit: (job: ExportJob) => void, beforeItem?: (signal: AbortSignal) => Promise<void>) {
      this.emit = emit;
      this.beforeItem = beforeItem;
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
      audioTracks: number[],
      extension: string,
      mode: "separate" | "combined",
      signal: AbortSignal
   ): Promise<CutAnalysis> {
      signal.throwIfAborted();
      const key = JSON.stringify([source.id, source.size, source.modified, clip.start, clip.end, audioTracks, extension, mode]);
      let pending = this.analyses.get(key);
      if (!pending) {
         pending = analyzeCut(source, clip, signal, { audioTracks, extension, combined: mode === "combined" }).catch((error: unknown) => {
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
      const audio = source.streams.filter((stream) => stream.type === "audio");
      const tracks = exportAudioTracks(source, settings.audioTracks);
      const items = [...settings.items].sort((a, b) => a.clip.start - b.clip.start);
      const results: CutAnalysis[] = new Array(items.length);
      let next = 0;
      await Promise.all(
         Array.from({ length: Math.min(2, items.length) }, async () => {
            while (next < items.length) {
               const index = next++;
               const item = items[index]!;
               const extension = exportExtensionFor(source, item.clip, { separate: settings.mode === "separate", allAudio: tracks.length === audio.length });
               results[index] = await this.cut(source, item.clip, tracks, extension, settings.mode, signal);
            }
         })
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
      const conflictFor = async (path: string): Promise<string | null> => {
         if (await protectSource(source.path, path, true)) return "Will replace the source video";
         return (await exists(path)) ? "Will replace an existing file" : null;
      };
      if (settings.mode === "combined") return { items: [{ clipId: null, conflict: await conflictFor(join(directoryPath, names[0]!)) }] };
      const sorted = [...settings.items].sort((a, b) => a.clip.start - b.clip.start);
      const items: DestinationConflict[] = [];
      for (const [index, item] of sorted.entries()) items.push({ clipId: item.clip.id, conflict: await conflictFor(join(directoryPath, names[index]!)) });
      return { items };
   }
   async plan(source: ProbedSource, request: PlanRequest): Promise<ExportPlan> {
      const settings = planRequestSchema.parse(request);
      const signal = this.analysisController.signal;
      const audioTracks = exportAudioTracks(source, settings.audioTracks);
      const directoryPath = resolve(settings.directory);
      const directory = await stat(directoryPath).catch((error: NodeJS.ErrnoException) => {
         if (error.code === "ENOENT") return null;
         throw new Error(`Cannot access the output folder: ${error.message}`);
      });
      if (directory && !directory.isDirectory()) throw new Error("Choose an output folder, not a file.");
      if (directory) await access(directoryPath, constants.W_OK);
      const names = outputNames(source, settings);
      const itemNames = settings.mode === "combined" ? outputNames(source, { ...settings, mode: "separate" }) : names;
      const cuts = await this.analyze(source, settings, signal);
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
      const existingPaths: string[] = [];
      let sourcePath: string | null = null;
      for (const item of items) {
         if (await protectSource(source.path, item.outputPath, true)) sourcePath = item.outputPath;
         if (await exists(item.outputPath)) existingPaths.push(item.outputPath);
      }
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
      this.plans.set(plan.id, { plan, source, analyses, audioTracks });
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
               audioTracks: stored.audioTracks,
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
function exportAudioTracks(source: ProbedSource, selected: number[] | null): number[] {
   const available = source.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index);
   const tracks = selected ?? available;
   if (new Set(tracks).size !== tracks.length || tracks.some((index) => !available.includes(index)))
      throw new Error("One or more selected audio tracks were not found.");
   return tracks;
}
function outputNames(source: ProbedSource, request: ReturnType<typeof planRequestSchema.parse>): string[] {
   if (request.mode === "combined") {
      const extension = source.exportExtension;
      return [`${sanitizeName(request.name.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), ""))}${extension}`];
   }
   const audio = source.streams.filter((stream) => stream.type === "audio");
   const allAudio = (request.audioTracks ?? audio.map((stream) => stream.index)).length === audio.length;
   const used = new Set<string>();
   return [...request.items]
      .sort((a, b) => a.clip.start - b.clip.start)
      .map((item) => {
         const extension = exportExtensionFor(source, item.clip, { separate: true, allAudio });
         const stem = sanitizeName(item.name.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), ""));
         let name = `${stem}${extension}`;
         let suffix = 2;
         while (used.has(name.toLowerCase())) name = `${stem} (${suffix++})${extension}`;
         used.add(name.toLowerCase());
         return name;
      });
}
async function exists(path: string): Promise<boolean> {
   try {
      await access(path);
      return true;
   } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
   }
}
