import type { FrameRequest, WaveformRequest } from "./media-requests";
import type { Preferences } from "./preferences";
import type { SavedSession } from "./editing";
import type { SessionInput } from "./session-codec";
import type { DetectedRange, MediaSource, RangeDetection, ScrubAudio } from "./media";
import type { RecentEntry } from "./recent";
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
   /** A previous restart did not install this version; the app offers the manual route. */
   notApplied?: boolean;
}
export interface UpdateStatus {
   /** "installing" follows an explicit restart: it can wait for an export, then hands over to the installer. */
   phase: "downloading" | "ready" | "downloaded" | "error" | "installing" | "not-applied";
   version: string;
   percent: number | null;
   message?: string;
   path?: string;
   /** Set while an explicit restart waits for the running export to finish. */
   waitingFor?: "export";
}
export interface DesktopApi {
   bootstrap(): Promise<Bootstrap>;
   checkForUpdate(): Promise<AvailableUpdate | null>;
   downloadUpdate(version: string): Promise<void>;
   restartToUpdate(): Promise<void>;
   cancelUpdateRestart(): Promise<void>;
   /** The update a previous restart tried and failed to apply, reported once. */
   takeUpdateOutcome(): Promise<AvailableUpdate | null>;
   onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
   chooseSource(): Promise<string | null>;
   openSource(path: string): Promise<MediaSource>;
   openProject(path: string): Promise<{ source: MediaSource; session: SavedSession } | null>;
   /** Recently opened videos and projects, newest first, with files that have since moved flagged. */
   recentFiles(): Promise<RecentEntry[]>;
   removeRecentFile(path: string): Promise<void>;
   clearRecentFiles(): Promise<void>;
   onRecentFilesChanged(listener: () => void): () => void;
   saveProject(session: SessionInput, saveAs?: boolean): Promise<SavedSession | null>;
   confirmProject(session: SessionInput): Promise<"save" | "discard" | "cancel">;
   closeSource(): Promise<void>;
   filePath(file: File): string;
   chooseDirectory(current: string): Promise<string | null>;
   savePreferences(value: Preferences): Promise<void>;
   saveSession(value: SessionInput): Promise<void>;
   factoryReset(): Promise<void>;
   setWindowTitle(title: string): Promise<void>;
   preparePreview(sourceId: string, audioIndices: number[], transcode: boolean): Promise<string>;
   cancelPreview(): Promise<void>;
   keyframes(sourceId: string): Promise<number[]>;
   autoDetectCuts(request: { sourceId: string; requestId: string; threshold: number }): Promise<number[]>;
   detectRanges(request: { sourceId: string; requestId: string; detection: RangeDetection }): Promise<DetectedRange[]>;
   /** Cancels a scene or range scan by its request id. */
   cancelDetection(requestId: string): Promise<void>;
   writeClipboard(text: string): Promise<void>;
   scrubAudio(sourceId: string, streamIndices: number[], time?: number): Promise<ScrubAudio | null>;
   cancelScrub(): Promise<void>;
   waveformStart(request: WaveformRequest): Promise<{ rate: number; buckets: number } | null>;
   cancelWaveform(requestId: string): Promise<void>;
   waveformActivity(requestId: string, busy: boolean): Promise<void>;
   waveformRegion(requestId: string, from: number, to: number): Promise<void>;
   onWaveformChunk(
      listener: (chunk: { sourceId: string; requestId: string; rate: number; offset: number; peaks: Uint8Array; priority?: boolean }) => void
   ): () => void;
   frameTime(sourceId: string, time: number, direction: -1 | 0 | 1): Promise<number>;
   frameTimes(sourceId: string, times: number[]): Promise<number[]>;
   cancelExportAnalysis(): Promise<void>;
   flushState(value: { preferences: Preferences; session: SessionInput | null; closing?: boolean; cancelClose?: boolean }): Promise<void>;
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
