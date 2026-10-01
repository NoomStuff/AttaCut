import type { z } from "zod";
import type { DesktopApi } from "./desktop";
import type { ipcRequestSchemas } from "./ipc-requests";
type Result<K extends keyof DesktopApi> = Awaited<ReturnType<DesktopApi[K]>>;
interface IpcResponses {
   "app:bootstrap": Result<"bootstrap">;
   "update:check": Result<"checkForUpdate">;
   "update:download": void;
   "update:restart": void;
   "source:choose": string | null;
   "source:open": Result<"openSource">;
   "project:open": Result<"openProject">;
   "project:save": Result<"saveProject">;
   "project:confirm": Result<"confirmProject">;
   "source:close": void;
   "source:keyframes": number[];
   "source:frame-time": number;
   "directory:choose": string | null;
   "preferences:save": void;
   "session:save": void;
   "state:flush": void;
   "app:factory-reset": void;
   "window:title": void;
   "preview:prepare": string;
   "preview:cancel": void;
   "audio:scrub": Result<"scrubAudio">;
   "audio:cancel": void;
   "frame:export": string;
   "export:plan": Result<"planExport">;
   "export:check-destinations": Result<"checkExportDestinations">;
   "export:analyze": Result<"analyzeExport">;
   "export:cancel-planning": void;
   "export:cancel-analysis": void;
   "export:start": Result<"startExport">;
   "export:cancel": void;
   "export:retry": Result<"retryExport">;
   "output:open": void;
   "output:reveal": void;
   "open:external": void;
   "notices:open": void;
   "diagnostics:export": boolean;
}
export type IpcCalls = { [K in keyof IpcResponses]: { request: z.input<(typeof ipcRequestSchemas)[K]>; response: IpcResponses[K] } };
export type IpcRequest<K extends keyof IpcCalls> = z.output<(typeof ipcRequestSchemas)[K]>;
/** Push and fire-and-forget channels. Names live here so a rename cannot silently break a listener. */
export const IpcEvents = {
   jobProgress: "export:progress",
   updateStatus: "update:status",
   flush: "app:flush",
   flushStarted: "app:flush-started",
   openFile: "app:open-file",
   command: "app:command",
   windowAction: "window:action",
   windowFullscreen: "window:fullscreen",
   rendererReady: "app:renderer-ready",
} as const;
