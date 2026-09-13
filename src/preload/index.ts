import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopApi, ExportJob, PreviewProgress } from "../shared/types";
function listen<T>(channel: string, callback: (value: T) => void): () => void {
   const handler = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
   ipcRenderer.on(channel, handler);
   return () => {
      ipcRenderer.removeListener(channel, handler);
   };
}
const api: DesktopApi = {
   bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
   chooseSource: () => ipcRenderer.invoke("source:choose"),
   openSource: (path) => ipcRenderer.invoke("source:open", path),
   filePath: (file) => webUtils.getPathForFile(file),
   chooseDirectory: (current) => ipcRenderer.invoke("directory:choose", current),
   savePreferences: (value) => ipcRenderer.invoke("preferences:save", value),
   saveSession: (value) => ipcRenderer.invoke("session:save", value),
   clearSession: () => ipcRenderer.invoke("session:clear"),
   preparePreview: (sourceId, audioIndex, transcode) => ipcRenderer.invoke("preview:prepare", { sourceId, audioIndex, transcode }),
   cancelPreview: () => ipcRenderer.invoke("preview:cancel"),
   keyframes: (sourceId) => ipcRenderer.invoke("source:keyframes", sourceId),
   scrubAudio: (sourceId, streamIndex) => ipcRenderer.invoke("audio:scrub", { sourceId, streamIndex }),
   exportFrame: (request) => ipcRenderer.invoke("frame:export", request),
   planExport: (request) => ipcRenderer.invoke("export:plan", request),
   startExport: (id) => ipcRenderer.invoke("export:start", id),
   cancelExport: () => ipcRenderer.invoke("export:cancel"),
   retryExport: (id) => ipcRenderer.invoke("export:retry", id),
   revealOutput: (path) => ipcRenderer.invoke("output:reveal", path),
   openExternal: (url) => ipcRenderer.invoke("open:external", url),
   openNotices: () => ipcRenderer.invoke("notices:open"),
   windowAction: (action) => ipcRenderer.send("window:action", action),
   onJob: (callback) => listen<ExportJob>("export:progress", callback),
   onPreview: (callback) => listen<PreviewProgress>("preview:progress", callback),
   onCommand: (callback) => listen<string>("app:command", callback),
};
contextBridge.exposeInMainWorld("desktop", api);
