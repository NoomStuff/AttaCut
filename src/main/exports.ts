import { randomUUID } from "node:crypto";
import { access, constants, mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { ExportApproval, ExportJob, ExportPlan, PlanRequest } from "../shared/types.ts";
import { exportExtensionFor, planRequestSchema } from "../shared/types.ts";
import { analyzeCut, exportCut } from "./media/cut.ts";
import type { CutAnalysis } from "./media/cut.ts";
import type { ProbedSource } from "./media/probe.ts";
import { protectSource } from "./media/publish.ts";
import { exportCombined } from "./media/combine.ts";

interface StoredPlan {
   plan: ExportPlan;
   source: ProbedSource;
   analyses: Map<string, CutAnalysis[]>;
   audioTracks: number[];
   approval?: ExportApproval;
}
export class ExportService {
   private plans = new Map<string, StoredPlan>();
   private controller: AbortController | null = null;
   private job: ExportJob | null = null;
   private runningPlan: StoredPlan | null = null;
   private completion: Promise<void> = Promise.resolve();
   private emit: (job: ExportJob) => void;
   constructor(emit: (job: ExportJob) => void) {
      this.emit = emit;
   }
   get running(): boolean {
      return this.job?.running ?? false;
   }
   get current(): ExportJob | null {
      return this.job;
   }
   async plan(source: ProbedSource, request: PlanRequest): Promise<ExportPlan> {
      const settings = planRequestSchema.parse(request);
      const sourceAudio = source.streams.filter((stream) => stream.type === "audio");
      const audioTracks = settings.audioTracks ?? sourceAudio.map((stream) => stream.index);
      if (new Set(audioTracks).size !== audioTracks.length || audioTracks.some((index) => !sourceAudio.some((stream) => stream.index === index)))
         throw new Error("One or more selected audio tracks were not found.");
      const directoryPath = resolve(request.directory);
      const directory = await stat(directoryPath).catch((error: NodeJS.ErrnoException) => {
         if (error.code === "ENOENT") return null;
         throw new Error(`Cannot access the output folder: ${error.message}`);
      });
      if (directory && !directory.isDirectory()) throw new Error("Choose an output folder, not a file.");
      if (directory) await access(directoryPath, constants.W_OK);
      const used = new Set<string>();
      const analyses = new Map<string, CutAnalysis[]>();
      const items = [];
      for (const item of [...request.items].sort((a, b) => a.clip.start - b.clip.start)) {
         const extension = exportExtensionFor(source, item.clip, {
            separate: settings.mode === "separate",
            allAudio: audioTracks.length === sourceAudio.length,
         });
         const stem = sanitizeName(item.name.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), ""));
         let name = `${stem}${extension}`;
         let suffix = 2;
         while (used.has(name.toLowerCase())) name = `${stem} (${suffix++})${extension}`;
         used.add(name.toLowerCase());
         const analysis = await analyzeCut(source, item.clip);
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
         });
      }
      if (settings.mode === "combined") {
         const cuts = items.flatMap((item) => analyses.get(item.id)!);
         const extension = source.exportExtension;
         const stem = sanitizeName(settings.name.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), ""));
         const name = `${stem}${extension}`;
         const first = items[0]!;
         const unsupported = cuts.filter((cut) => cut.method === "unsupported");
         const combined = {
            ...first,
            name,
            outputPath: join(directoryPath, name),
            method: unsupported.length ? ("unsupported" as const) : cuts.some((cut) => cut.method === "boundary") ? ("boundary" as const) : ("copy" as const),
            message: [...new Set(unsupported.map((cut) => cut.message))].join(" "),
            encodedSeconds: cuts.reduce((sum, cut) => sum + cut.encodedSeconds, 0),
         };
         analyses.set(first.id, cuts);
         items.splice(0, items.length, combined);
      }
      const existingPaths: string[] = [];
      for (const item of items) {
         await protectSource(source.path, item.outputPath);
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
      };
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
      if (stored.plan.items.some((item) => item.method === "unsupported")) throw new Error("Some clips cannot be exported with these boundaries.");
      this.runningPlan = stored;
      stored.approval = approval;
      this.job = {
         id: randomUUID(),
         directory: stored.plan.directory,
         running: true,
         items: stored.plan.items.map((item) => ({
            id: item.id,
            name: item.name,
            outputPath: item.outputPath,
            status: "queued",
            progress: 0,
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
      for (const item of this.job.items)
         if (item.status !== "completed") {
            item.status = "queued";
            item.error = null;
            item.progress = 0;
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
         if (item.status === "completed") continue;
         if (signal.aborted) {
            item.status = "cancelled";
            continue;
         }
         item.status = "running";
         this.emit(structuredClone(job));
         try {
            if (stored.approval?.createDirectory) await mkdir(stored.plan.directory, { recursive: true });
            await protectSource(stored.source.path, item.outputPath);
            const cuts = stored.analyses.get(item.id)!;
            const options = {
               signal,
               audioTracks: stored.audioTracks,
               overwrite: !!stored.approval?.overwrite && stored.plan.existingPaths.includes(item.outputPath),
               onProgress: (value: number) => {
                  item.progress = value;
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
         }
         this.emit(structuredClone(job));
      }
      job.running = false;
      this.emit(structuredClone(job));
   }
}
export function sanitizeName(value: string): string {
   const clean = Array.from(value, (character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .join("")
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/[. ]+$/, "")
      .trim();
   if (!clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) return `clip-${clean || "untitled"}`;
   return clean.slice(0, 180);
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
export function sourceStem(path: string): string {
   return basename(path, extname(path));
}
