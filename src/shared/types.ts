import { z } from "zod";

export const clipSchema = z
   .object({
      id: z.string().min(1),
      start: z.number().finite().nonnegative(),
      end: z.number().finite().positive(),
      color: z.number().int().nonnegative(),
   })
   .refine((clip) => clip.end > clip.start, "A clip must have a positive duration.");
export type Clip = z.infer<typeof clipSchema>;

export interface MediaStream {
   index: number;
   type: string;
   codec: string;
   title: string;
   language: string;
   width: number;
   height: number;
   pixelFormat: string;
   profile: string;
   timeBase: string;
   frameRate: number;
   colorTransfer: string;
   colorPrimaries: string;
   colorSpace: string;
   colorRange: string;
   chromaLocation: string;
   rotation: number;
   fieldOrder: string;
   masterDisplay: string;
   maxCll: string;
   dynamicHdr: boolean;
   attachedPicture: boolean;
   disposition: Record<string, number>;
}
export interface MediaSource {
   id: string;
   path: string;
   name: string;
   directory: string;
   extension: string;
   exportExtension: string;
   duration: number;
   size: number;
   modified: number;
   streams: MediaStream[];
   url: string;
   chapters: { start: number; end: number; title: string }[];
}
export const preferencesSchema = z.object({
   theme: z.enum(["dark", "light"]).default("dark"),
   outputDirectory: z.string().default(""),
   keptOnly: z.boolean().default(false),
   keepPlaying: z.boolean().default(false),
   volume: z.number().min(0).max(1).default(0.7),
   shortcuts: z.record(z.string(), z.array(z.string())).default({}),
   exportMode: z.enum(["separate", "combined"]).default("separate"),
   exportMuted: z.boolean().default(false),
   frameFormat: z.enum(["png", "jpg"]).default("png"),
   frameQuality: z.number().min(1).max(100).default(95),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = preferencesSchema.parse({});
export const savedSessionSchema = z
   .object({
      path: z.string(),
      size: z.number(),
      modified: z.number(),
      clips: z.array(clipSchema).max(500),
      selectedId: z.string().nullable(),
   })
   .refine(
      (session) =>
         new Set(session.clips.map((clip) => clip.id)).size === session.clips.length &&
         session.clips.every((clip, index) => index === 0 || clip.start >= session.clips[index - 1]!.end) &&
         (session.selectedId === null || session.clips.some((clip) => clip.id === session.selectedId)),
      "Saved clips are inconsistent."
   );
export type SavedSession = z.infer<typeof savedSessionSchema>;
export interface Bootstrap {
   preferences: Preferences;
   session: SavedSession | null;
   platform: string;
   version: string;
   initialFile: string | null;
}
export const exportItemSchema = z.object({ clip: clipSchema, name: z.string().min(1).max(240) });
export const planRequestSchema = z.object({
   sourceId: z.string(),
   directory: z.string().min(1),
   items: z.array(exportItemSchema).min(1).max(500),
   mode: z.enum(["separate", "combined"]).default("separate"),
   muteAudio: z.boolean().default(false),
   name: z.string().max(240).default("combined"),
});
export type PlanRequest = z.input<typeof planRequestSchema>;
export const frameRequestSchema = z.object({
   sourceId: z.string(),
   time: z.number().finite().nonnegative(),
   directory: z.string().min(1),
   name: z.string().min(1).max(240),
   format: z.enum(["png", "jpg"]),
   quality: z.number().min(1).max(100),
});
export type FrameRequest = z.infer<typeof frameRequestSchema>;
export interface ExportPlanItem {
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
}
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface JobItem {
   id: string;
   name: string;
   outputPath: string;
   status: JobStatus;
   progress: number;
   error: string | null;
}
export interface ExportJob {
   id: string;
   directory: string;
   items: JobItem[];
   running: boolean;
}
export interface PreviewProgress {
   sourceId: string;
   progress: number;
   running: boolean;
}
export interface DesktopApi {
   bootstrap(): Promise<Bootstrap>;
   chooseSource(): Promise<string | null>;
   openSource(path: string): Promise<MediaSource>;
   filePath(file: File): string;
   chooseDirectory(current: string): Promise<string | null>;
   savePreferences(value: Preferences): Promise<void>;
   saveSession(value: SavedSession): Promise<void>;
   clearSession(): Promise<void>;
   preparePreview(sourceId: string, audioIndex: number | null, transcode: boolean): Promise<string>;
   cancelPreview(): Promise<void>;
   keyframes(sourceId: string): Promise<number[]>;
   exportFrame(request: FrameRequest): Promise<string>;
   planExport(request: PlanRequest): Promise<ExportPlan>;
   startExport(planId: string): Promise<ExportJob>;
   cancelExport(): Promise<void>;
   retryExport(jobId: string): Promise<ExportJob>;
   revealOutput(path: string): Promise<void>;
   windowAction(action: "minimize" | "maximize" | "close"): void;
   onJob(listener: (job: ExportJob) => void): () => void;
   onPreview(listener: (progress: PreviewProgress) => void): () => void;
   onCommand(listener: (command: string) => void): () => void;
}
