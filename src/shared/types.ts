import { z } from "zod";

import { clipColorCount } from "./defaults";
export { clipColorCount, defaultPreferences, undoLimit } from "./defaults";
import { undoLimit } from "./defaults";

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
   startTime?: number;
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
export const audioSelectionPreferenceSchema = z.object({
   mode: z.enum(["default", "all", "tracks"]).default("default"),
   sourceTrackCount: z.number().int().nonnegative().default(0),
   tracks: z
      .array(
         z.object({
            position: z.number().int().nonnegative(),
            title: z.string(),
            language: z.string(),
         })
      )
      .default([]),
});
export type AudioSelectionPreference = z.infer<typeof audioSelectionPreferenceSchema>;
export const preferencesSchema = z.object({
   theme: z.enum(["dark", "system", "light"]).default("dark"),
   accent: z
      .number()
      .int()
      .min(0)
      .max(clipColorCount - 1)
      .default(0),
   outputDirectory: z.string().default(""),
   keptOnly: z.boolean().default(false),
   keepPlaying: z.boolean().default(false),
   audioScrub: z.boolean().default(false),
   snapping: z.boolean().default(false),
   volume: z.number().min(0).max(1).default(0.7),
   shortcuts: z.record(z.string(), z.array(z.string())).default({}),
   exportMode: z.enum(["separate", "combined"]).default("separate"),
   playbackAudio: audioSelectionPreferenceSchema.default({ mode: "default", sourceTrackCount: 0, tracks: [] }),
   exportAudio: audioSelectionPreferenceSchema.default({ mode: "default", sourceTrackCount: 0, tracks: [] }),
   frameFormat: z.enum(["png", "jpg"]).default("png"),
   frameQuality: z.number().min(1).max(100).default(95),
});
export type Preferences = z.infer<typeof preferencesSchema>;

const savedDocumentShape = {
   clips: z.array(clipSchema).max(500),
   selectedId: z.string().nullable(),
};
const savedDocumentInvariant = (document: { clips: Clip[]; selectedId: string | null }): boolean =>
   new Set(document.clips.map((clip) => clip.id)).size === document.clips.length &&
   document.clips.every((clip, index) => index === 0 || clip.start >= document.clips[index - 1]!.end) &&
   (document.selectedId === null || document.clips.some((clip) => clip.id === document.selectedId));
export const savedDocumentSchema = z.object(savedDocumentShape).refine(savedDocumentInvariant, "Saved clips are inconsistent.");
export type SavedDocument = z.infer<typeof savedDocumentSchema>;
export const savedSessionSchema = z
   .object({
      path: z.string(),
      size: z.number(),
      modified: z.number(),
      ...savedDocumentShape,
      past: z.array(savedDocumentSchema).max(undoLimit).default([]),
      future: z.array(savedDocumentSchema).max(undoLimit).default([]),
   })
   .refine(savedDocumentInvariant, "Saved clips are inconsistent.");
export type SavedSession = z.infer<typeof savedSessionSchema>;
export interface Bootstrap {
   warning: string | null;
   preferences: Preferences;
   session: SavedSession | null;
   platform: string;
   version: string;
   initialFile: string | null;
}
export interface AvailableUpdate {
   version: string;
   name: string;
   url: string;
}
export const exportItemSchema = z.object({ clip: clipSchema, name: z.string().min(1).max(240) });
export const planRequestSchema = z.object({
   sourceId: z.string(),
   directory: z.string().min(1),
   items: z.array(exportItemSchema).min(1).max(500),
   mode: z.enum(["separate", "combined"]).default("separate"),
   audioTracks: z.array(z.number().int().nonnegative()).max(100).nullable().default(null),
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
   directoryMissing: boolean;
   existingPaths: string[];
}
export type CutReport = Pick<ExportPlanItem, "clip" | "method" | "encodedSeconds" | "message">;
export interface ExportApproval {
   createDirectory?: boolean | undefined;
   overwrite?: boolean | undefined;
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
/** One bounded chunk of mono 16-bit PCM for scrub bursts. */
export interface ScrubAudio {
   start: number;
   sampleRate: number;
   pcm: ArrayBuffer;
}

export { exportExtensionFor } from "./export-format";
export interface DesktopApi {
   bootstrap(): Promise<Bootstrap>;
   checkForUpdate(): Promise<AvailableUpdate | null>;
   dismissUpdate(version: string, ignore: boolean): Promise<void>;
   chooseSource(): Promise<string | null>;
   openSource(path: string): Promise<MediaSource>;
   filePath(file: File): string;
   chooseDirectory(current: string): Promise<string | null>;
   savePreferences(value: Preferences): Promise<void>;
   saveSession(value: SavedSession): Promise<void>;
   clearSession(): Promise<void>;
   preparePreview(sourceId: string, audioIndices: number[], transcode: boolean): Promise<string>;
   cancelPreview(): Promise<void>;
   keyframes(sourceId: string): Promise<number[]>;
   scrubAudio(sourceId: string, streamIndices: number[], time?: number): Promise<ScrubAudio | null>;
   cancelScrub(): Promise<void>;
   frameTime(sourceId: string, time: number, direction: -1 | 0 | 1): Promise<number>;
   cancelExportPlanning(): Promise<void>;
   flushState(value: { preferences: Preferences; session: SavedSession | null }): Promise<void>;
   onFlush(listener: () => void): () => void;
   onOpenFile(listener: (path: string) => void): () => void;
   exportFrame(request: FrameRequest): Promise<string>;
   planExport(request: PlanRequest): Promise<ExportPlan>;
   analyzeExport(request: PlanRequest): Promise<CutReport[]>;
   startExport(planId: string, approval?: ExportApproval): Promise<ExportJob>;
   cancelExport(): Promise<void>;
   retryExport(jobId: string): Promise<ExportJob>;
   revealOutput(path: string): Promise<void>;
   openOutput(path: string): Promise<void>;
   openExternal(url: string): Promise<void>;
   openNotices(): Promise<void>;
   windowAction(action: "minimize" | "maximize" | "close"): void;
   onJob(listener: (job: ExportJob) => void): () => void;
   onCommand(listener: (command: string) => void): () => void;
}
