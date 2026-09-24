import type {
   AnalyzeRequest,
   DesktopApi,
   ExportApproval,
   FrameRequest,
   FrameTimeRequest,
   PlanRequest,
   Preferences,
   PreviewRequest,
   SavedSession,
   ScrubRequest,
} from "./types";
type Result<K extends keyof DesktopApi> = Awaited<ReturnType<DesktopApi[K]>>;
type Call<Request, Response> = { request: Request; response: Response };
export interface IpcCalls {
   "app:bootstrap": Call<void, Result<"bootstrap">>;
   "update:check": Call<void, Result<"checkForUpdate">>;
   "update:dismiss": Call<{ version: string; ignore: boolean }, void>;
   "source:choose": Call<void, string | null>;
   "source:open": Call<string, Result<"openSource">>;
   "source:keyframes": Call<string, number[]>;
   "source:frame-time": Call<FrameTimeRequest, number>;
   "directory:choose": Call<string, string | null>;
   "preferences:save": Call<Preferences, void>;
   "session:save": Call<SavedSession, void>;
   "state:flush": Call<{ preferences: Preferences; session: SavedSession | null }, void>;
   "preview:prepare": Call<PreviewRequest, string>;
   "preview:cancel": Call<void, void>;
   "audio:scrub": Call<ScrubRequest, Result<"scrubAudio">>;
   "audio:cancel": Call<void, void>;
   "frame:export": Call<FrameRequest, string>;
   "export:plan": Call<PlanRequest, Result<"planExport">>;
   "export:check-destinations": Call<PlanRequest, Result<"checkExportDestinations">>;
   "export:analyze": Call<AnalyzeRequest, Result<"analyzeExport">>;
   "export:cancel-planning": Call<void, void>;
   "export:start": Call<{ id: string; approval: ExportApproval | undefined }, Result<"startExport">>;
   "export:cancel": Call<void, void>;
   "export:retry": Call<string, Result<"retryExport">>;
   "output:open": Call<string, void>;
   "output:reveal": Call<string, void>;
   "open:external": Call<string, void>;
   "notices:open": Call<void, void>;
}
/** Push and fire-and-forget channels. Names live here so a rename cannot silently break a listener. */
export const IpcEvents = {
   jobProgress: "export:progress",
   flush: "app:flush",
   openFile: "app:open-file",
   command: "app:command",
   windowAction: "window:action",
} as const;
