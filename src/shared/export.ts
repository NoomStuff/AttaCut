import { z } from "zod";
import { clipSchema } from "./editing";
import type { Clip } from "./editing";
import type { AppFailure } from "./failure";
export const exportItemSchema = z.object({ clip: clipSchema, name: z.string().min(1).max(240) });
export const planRequestSchema = z.object({
   sourceId: z.string(),
   directory: z.string().min(1),
   items: z.array(exportItemSchema).min(1).max(1000),
   mode: z.enum(["separate", "combined"]).default("separate"),
   audioTracks: z.array(z.number().int().nonnegative()).max(100).nullable().default(null),
   name: z.string().max(240).default("combined"),
});
export type PlanRequest = z.input<typeof planRequestSchema>;
export const exportApprovalSchema = z.object({
   createDirectory: z.boolean().optional(),
   overwrite: z.boolean().optional(),
   replaceSource: z.boolean().optional(),
   substantialEncoding: z.boolean().optional(),
   mediaChanges: z.boolean().optional(),
});
export type ExportApproval = z.infer<typeof exportApprovalSchema>;
/** Media analysis is independent of the destination, so it never receives one. */
export const analyzeRequestSchema = planRequestSchema.omit({ directory: true });
export type AnalyzeRequest = z.input<typeof analyzeRequestSchema>;
export interface StreamAssessment {
   index: number;
   type: string;
   action: "copy" | "trim" | "encode" | "convert" | "omit" | "unsupported";
   reason: string;
}
export interface ExportPlanItem {
   streams?: StreamAssessment[];
   changes?: string[];
   duration?: number;
   id: string;
   clip: Clip;
   outputPath: string;
   name: string;
   method: "copy" | "boundary" | "unsupported";
   encodedSeconds: number;
   message: string;
}
export interface ExportPlan {
   id: string;
   sourceId: string;
   directory: string;
   items: ExportPlanItem[];
   mode: "separate" | "combined";
   directoryMissing: boolean;
   existingPaths: string[];
   sourcePath: string | null;
}
export interface DestinationConflict {
   /** Clip the conflict belongs to, or null for a combined export's single output. */
   clipId: string | null;
   conflict: string | null;
   /** Conflicts that would destroy the source or another output are dangerous, not just notable. */
   danger: boolean;
}
export interface ExportDestinations {
   items: DestinationConflict[];
}
export type CutReport = Pick<ExportPlanItem, "clip" | "method" | "encodedSeconds" | "message" | "changes" | "duration" | "streams">;
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ExportStage = "copying" | "encoding" | "checking" | "saving";
export interface JobItem {
   stage?: ExportStage;
   duration?: number;
   /** Source range behind this output, so a failure names the cut it came from. */
   start?: number;
   end?: number;
   id: string;
   name: string;
   outputPath: string;
   status: JobStatus;
   progress: number;
   error: string | null;
   failure?: AppFailure;
}
export interface ExportJob {
   id: string;
   sourceId: string;
   replacesSource: boolean;
   directory: string;
   items: JobItem[];
   running: boolean;
}
