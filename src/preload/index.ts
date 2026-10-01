import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopApi, ExportJob, UpdateStatus } from "../shared/types";
import { IpcEvents, type IpcCalls } from "../shared/ipc";
import type { IpcResult } from "../shared/failure";
async function invoke<K extends keyof IpcCalls>(
   channel: K,
   ...args: IpcCalls[K]["request"] extends void ? [] : [IpcCalls[K]["request"]]
): Promise<IpcCalls[K]["response"]> {
   const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<IpcCalls[K]["response"]>;
   if (!result.ok) throw result.error;
   return result.value;
}
function listen<T>(channel: string, callback: (value: T) => void): () => void {
   const handler = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
   ipcRenderer.on(channel, handler);
   return () => {
      ipcRenderer.removeListener(channel, handler);
   };
}
const api: DesktopApi = {
   bootstrap: () => invoke("app:bootstrap"),
   checkForUpdate: () => invoke("update:check"),
   downloadUpdate: (version) => invoke("update:download", version),
   restartToUpdate: () => invoke("update:restart"),
   onUpdateStatus: (callback) => listen<UpdateStatus>(IpcEvents.updateStatus, callback),
   chooseSource: () => invoke("source:choose"),
   openSource: (path) => invoke("source:open", path),
   openProject: (path) => invoke("project:open", path),
   saveProject: (session, saveAs = false) => invoke("project:save", { session, saveAs }),
   confirmProject: (session) => invoke("project:confirm", session),
   closeSource: () => invoke("source:close"),
   filePath: (file) => webUtils.getPathForFile(file),
   chooseDirectory: (current) => invoke("directory:choose", current),
   savePreferences: (value) => invoke("preferences:save", value),
   saveSession: (value) => invoke("session:save", value),
   factoryReset: () => invoke("app:factory-reset"),
   setWindowTitle: (title) => invoke("window:title", title),
   preparePreview: (sourceId, audioIndices, transcode) => invoke("preview:prepare", { sourceId, audioIndices, transcode }),
   cancelPreview: () => invoke("preview:cancel"),
   keyframes: (sourceId) => invoke("source:keyframes", sourceId),
   scrubAudio: (sourceId, streamIndices, time = 0) => invoke("audio:scrub", { sourceId, streamIndices, time }),
   cancelScrub: () => invoke("audio:cancel"),
   frameTime: (sourceId, time, direction) => invoke("source:frame-time", { sourceId, time, direction }),
   cancelExportPlanning: () => invoke("export:cancel-planning"),
   cancelExportAnalysis: () => invoke("export:cancel-analysis"),
   flushState: (value) => invoke("state:flush", value),
   onFlush: (callback) => listen<void>(IpcEvents.flush, callback),
   flushStarted: () => ipcRenderer.send(IpcEvents.flushStarted),
   onOpenFile: (callback) => listen<string>(IpcEvents.openFile, callback),
   exportFrame: (request) => invoke("frame:export", request),
   planExport: (request) => invoke("export:plan", request),
   checkExportDestinations: (request) => invoke("export:check-destinations", request),
   analyzeExport: (request) => invoke("export:analyze", request),
   startExport: (id, approval) => invoke("export:start", { id, approval }),
   cancelExport: () => invoke("export:cancel"),
   retryExport: (id) => invoke("export:retry", id),
   revealOutput: (path) => invoke("output:reveal", path),
   openOutput: (path) => invoke("output:open", path),
   openExternal: (url) => invoke("open:external", url),
   openNotices: () => invoke("notices:open"),
   exportDiagnostics: () => invoke("diagnostics:export"),
   windowAction: (action) => ipcRenderer.send(IpcEvents.windowAction, action),
   rendererReady: () => ipcRenderer.send(IpcEvents.rendererReady),
   onJob: (callback) => listen<ExportJob>(IpcEvents.jobProgress, callback),
   onCommand: (callback) => listen<string>(IpcEvents.command, callback),
};
contextBridge.exposeInMainWorld("desktop", api);
