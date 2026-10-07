import type { CutReport, ExportJob, ExportStage } from "../shared/export";
import type { MediaSource } from "../shared/media";
import type { FailureCode } from "../shared/failure";
import type { IpcCalls } from "../shared/ipc";
import type { ProbedSource } from "./media/probe";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

interface DiagnosticEvent {
   action:
      | keyof IpcCalls
      | "ffmpeg"
      | "ffprobe"
      | "export:stage"
      | "waveform:first-chunk"
      | "waveform:decode"
      | "waveform:paused"
      | "waveform:priority"
      | "waveform:encode"
      | "waveform:delivery"
      | "waveform:read-decode";
   stage?: ExportStage;
   elapsedMs: number;
   outcome: "ok" | FailureCode;
}
const recent: DiagnosticEvent[] = [];
let assessment: { sourceId: string; items: ReturnType<typeof summarizedAssessment> } | null = null;
export function recordDiagnostic(action: DiagnosticEvent["action"], elapsedMs: number, outcome: DiagnosticEvent["outcome"] = "ok", stage?: ExportStage): void {
   recent.push({ action, elapsedMs: Math.round(elapsedMs), outcome, ...(stage ? { stage } : {}) });
   if (recent.length > 200) recent.splice(0, recent.length - 200);
}
/** Diagnostics must remain available after a source disappears, while still protecting its surviving hard links. */
export async function protectDiagnosticDestination(destination: string, sources: Iterable<ProbedSource | null>): Promise<void> {
   const output = await stat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
   });
   if (output && !output.isFile()) throw new Error("Choose a file for the diagnostic report.");
   const normalized = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
   for (const source of sources) {
      if (!source) continue;
      if (normalized(destination) === normalized(source.path)) throw new Error("The diagnostic report cannot replace the source video.");
      const current = await stat(source.path).catch((error: NodeJS.ErrnoException) => {
         if (error.code === "ENOENT") return null;
         throw error;
      });
      const identities = [source.fileIdentity, current ? { device: current.dev, inode: current.ino } : null];
      if (output && identities.some((identity) => identity && output.dev === identity.device && output.ino === identity.inode))
         throw new Error("The diagnostic filename is linked to the source video. Choose a different filename.");
   }
}
function summarizedAssessment(reports: CutReport[]) {
   return reports.slice(0, 50).map((report) => ({
      method: report.method,
      encodingNeeded: report.encodedSeconds > 0,
      streams: report.streams?.map((stream) => ({ type: stream.type, action: stream.action })),
   }));
}
export function recordAssessment(sourceId: string, reports: CutReport[]): void {
   assessment = { sourceId, items: summarizedAssessment(reports) };
}
/** Deliberately select fields. Raw requests, source paths, titles and diagnostic messages never enter this report. */
export function diagnosticReport(version: string, tools: Record<string, string>, source: MediaSource | null, job: ExportJob | null) {
   return {
      version: 1,
      appVersion: version,
      system: {
         platform: process.platform,
         arch: process.arch,
         electron: process.versions.electron,
         node: process.versions.node,
         chrome: process.versions.chrome,
      },
      tools,
      media: source
         ? {
              container: source.extension,
              streams: source.streams.map((stream) => ({
                 type: stream.type,
                 codec: stream.codec,
                 width: stream.width,
                 height: stream.height,
                 frameRate: stream.frameRate,
                 sampleRate: stream.sampleRate,
                 channels: stream.channels,
                 channelLayout: stream.channelLayout,
                 pixelFormat: stream.pixelFormat,
                 sampleAspectRatio: stream.sampleAspectRatio,
                 fieldOrder: stream.fieldOrder,
                 colorTransfer: stream.colorTransfer,
                 colorPrimaries: stream.colorPrimaries,
                 colorSpace: stream.colorSpace,
                 dynamicHdr: stream.dynamicHdr,
                 attachedPicture: stream.attachedPicture,
              })),
           }
         : null,
      assessment: assessment?.sourceId === source?.id ? assessment?.items : null,
      export: job ? { running: job.running, items: job.items.map((item) => ({ status: item.status, stage: item.stage, outcome: item.failure?.code })) } : null,
      operations: recent.map((event) => ({ ...event })),
   };
}
