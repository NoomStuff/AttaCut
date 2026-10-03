import type { FrameRequest, WaveformRequest } from "./media-requests";
import type { Preferences } from "./preferences";
import type { SavedSession } from "./editing";
import type { MediaSource, ScrubAudio } from "./media";
import type { PlanRequest, AnalyzeRequest, ExportApproval, ExportPlan, ExportDestinations, CutReport, ExportJob } from "./export";
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
   mode: "automatic" | "download" | "releases";
}
export interface UpdateStatus {
   phase: "downloading" | "ready" | "downloaded" | "error";
   version: string;
   percent: number | null;
   message?: string;
   path?: string;
}
export interface DesktopApi {
   bootstrap(): Promise<Bootstrap>;
   checkForUpdate(): Promise<AvailableUpdate | null>;
   downloadUpdate(version: string): Promise<void>;
   restartToUpdate(): Promise<void>;
   onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
   chooseSource(): Promise<string | null>;
   openSource(path: string): Promise<MediaSource>;
   openProject(path: string): Promise<{ source: MediaSource; session: SavedSession } | null>;
   saveProject(session: SavedSession, saveAs?: boolean): Promise<SavedSession | null>;
   confirmProject(session: SavedSession): Promise<"save" | "discard" | "cancel">;
   closeSource(): Promise<void>;
   filePath(file: File): string;
   chooseDirectory(current: string): Promise<string | null>;
   savePreferences(value: Preferences): Promise<void>;
   saveSession(value: SavedSession): Promise<void>;
   factoryReset(): Promise<void>;
   setWindowTitle(title: string): Promise<void>;
   preparePreview(sourceId: string, audioIndices: number[], transcode: boolean): Promise<string>;
   cancelPreview(): Promise<void>;
   keyframes(sourceId: string): Promise<number[]>;
   scrubAudio(sourceId: string, streamIndices: number[], time?: number): Promise<ScrubAudio | null>;
   cancelScrub(): Promise<void>;
   waveformStart(request: WaveformRequest): Promise<{ peaks: Uint8Array } | null>;
   cancelWaveform(): Promise<void>;
   onWaveformChunk(listener: (chunk: { sourceId: string; offset: number; peaks: Uint8Array }) => void): () => void;
   frameTime(sourceId: string, time: number, direction: -1 | 0 | 1): Promise<number>;
   cancelExportPlanning(): Promise<void>;
   cancelExportAnalysis(): Promise<void>;
   flushState(value: { preferences: Preferences; session: SavedSession | null; closing?: boolean; cancelClose?: boolean }): Promise<void>;
   onFlush(listener: () => void): () => void;
   flushStarted(): void;
   onOpenFile(listener: (path: string) => void): () => void;
   exportFrame(request: FrameRequest): Promise<string>;
   planExport(request: PlanRequest): Promise<ExportPlan>;
   checkExportDestinations(request: PlanRequest): Promise<ExportDestinations>;
   analyzeExport(request: AnalyzeRequest): Promise<CutReport[]>;
   startExport(planId: string, approval?: ExportApproval): Promise<ExportJob>;
   cancelExport(): Promise<void>;
   retryExport(jobId: string): Promise<ExportJob>;
   revealOutput(path: string): Promise<void>;
   openOutput(path: string): Promise<void>;
   openExternal(url: string): Promise<void>;
   openNotices(): Promise<void>;
   exportDiagnostics(): Promise<boolean>;
   windowAction(action: "minimize" | "maximize" | "close" | "enterFullscreen" | "exitFullscreen"): void;
   rendererReady(): void;
   onJob(listener: (job: ExportJob) => void): () => void;
   onCommand(listener: (command: string) => void): () => void;
   onWindowFullscreen(listener: (value: boolean) => void): () => void;
}
