import { app, dialog, ipcMain, net, shell, type BrowserWindow } from "electron";
import { isPackagedApp } from "./identity.ts";
import type { IpcTestAdapter } from "./ipc-test-adapter";
import { appFailure } from "./failure";
import type { IpcResult } from "../shared/failure";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { writeFile } from "node:fs/promises";
import { diagnosticReport, recordDiagnostic, recordAssessment, protectDiagnosticDestination } from "./diagnostics";
import { runMedia } from "./media/process";
import { publishOutput } from "./media/publish";
import { withTemporaryOutput } from "./media/transaction";
import { fileURLToPath } from "node:url";
import { ipcRequestSchemas } from "../shared/ipc-requests";
import type { IpcCalls, IpcRequest } from "../shared/ipc";
import { exportFrame } from "./media/frame.ts";
import { videoExtensions } from "./media/formats.ts";
import { fetchAvailableUpdate, UpdateManager } from "./updates.ts";
import type { SourceSession } from "./source-session.ts";
import type { ExportService } from "./exports.ts";
import type { Storage } from "./storage.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));

export function registerIpc({
   window,
   storage,
   sourceSession,
   exportsService,
   takeInitialFile,
   onFlushed,
   onApplyUpdate,
   testing = null,
}: {
   window: BrowserWindow;
   storage: Storage;
   sourceSession: SourceSession;
   exportsService: ExportService;
   takeInitialFile: () => string | null;
   onFlushed: () => void;
   onApplyUpdate: (install: () => void) => void;
   testing?: IpcTestAdapter | null;
}): void {
   const updates = new UpdateManager(window);
   const frameOutputs = new Set<string>();
   const getSource = (id: string) => sourceSession.get(id);
   if (testing) Object.defineProperty(globalThis, "attacutTestIpc", { value: testing });
   function handle<K extends keyof IpcCalls>(channel: K, action: (value: IpcRequest<K>) => IpcCalls[K]["response"] | Promise<IpcCalls[K]["response"]>): void {
      ipcMain.handle(channel, async (event, value: unknown): Promise<IpcResult<IpcCalls[K]["response"]>> => {
         const started = performance.now();
         try {
            if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Invalid application request.");
            const request = ipcRequestSchemas[channel].parse(value) as IpcRequest<K>;
            const result = await (testing ? testing.invoke(channel, () => action(request)) : action(request));
            recordDiagnostic(channel, performance.now() - started);
            return { ok: true, value: result };
         } catch (error) {
            const failure = appFailure(error);
            recordDiagnostic(channel, performance.now() - started, failure.code);
            return { ok: false, error: failure };
         }
      });
   }
   handle("app:bootstrap", () => {
      const initialFile = takeInitialFile();
      return {
         warning: storage.warning,
         preferences: storage.preferences,
         session: storage.session,
         platform: process.platform,
         version: app.getVersion(),
         initialFile,
      };
   });
   handle("update:check", async () => {
      if (!isPackagedApp()) return null;
      try {
         const update = await fetchAvailableUpdate(app.getVersion(), (url, init) => net.fetch(url, init));
         return update ? updates.offer(update) : null;
      } catch {
         return null;
      }
   });
   handle("update:download", async (value) => updates.downloadPortable(value));
   handle("update:restart", () => {
      if (!updates.isReady) throw new Error("The update is not ready yet.");
      onApplyUpdate(() => updates.install());
   });
   handle("source:choose", async () => {
      const result = await dialog.showOpenDialog(window, {
         title: "Import video",
         properties: ["openFile"],
         filters: [
            { name: "Video", extensions: videoExtensions },
            { name: "All files", extensions: ["*"] },
         ],
      });
      return result.filePaths[0] ?? null;
   });
   handle("source:open", async (value) => {
      const source = await sourceSession.open(value);
      exportsService.cancelPlanning();
      frameOutputs.clear();
      window.setTitle(`${source.name} — AttaCut`);
      return source;
   });
   handle("source:close", () => {
      sourceSession.close();
      exportsService.cancelPlanning();
      window.setTitle("AttaCut");
   });
   handle("directory:choose", async (value) => {
      const current = value;
      const result = await dialog.showOpenDialog(window, {
         properties: ["openDirectory", "createDirectory"],
         ...(current ? { defaultPath: current } : {}),
      });
      return result.filePaths[0] ?? null;
   });
   handle("source:keyframes", async (value) => {
      return sourceSession.keyframes(value);
   });
   handle("source:frame-time", async (value) => {
      const request = value;
      return sourceSession.frameTime(request.sourceId, request.time, request.direction);
   });
   handle("audio:scrub", async (value) => {
      const request = value;
      const source = getSource(request.sourceId);
      if (request.streamIndices.some((index) => !source.streams.some((stream) => stream.type === "audio" && stream.index === index)))
         throw new Error("Audio track not found.");
      return sourceSession.scrubAudio(source.id, request.streamIndices, request.time);
   });
   handle("audio:cancel", () => sourceSession.cancelScrub());
   handle("export:cancel-planning", () => exportsService.cancelPlanning());
   handle("export:cancel-analysis", () => exportsService.cancelAnalysis());
   handle("state:flush", async (value) => {
      const snapshot = value;
      storage.preferences = snapshot.preferences;
      storage.session = snapshot.session;
      await storage.save();
      onFlushed();
   });
   handle("frame:export", async (value) => {
      const request = value;
      const path = await exportFrame(getSource(request.sourceId), request, sourceSession.signal);
      frameOutputs.add(path);
      return path;
   });
   handle("preferences:save", async (value) => {
      storage.preferences = value;
      await storage.save();
   });
   handle("session:save", async (value) => {
      storage.session = value;
      await storage.save();
   });
   handle("app:factory-reset", async () => {
      await storage.reset();
   });
   handle("window:title", (value) => {
      window.setTitle(value);
   });
   handle("preview:prepare", async (value) => {
      const request = value;
      const source = getSource(request.sourceId);
      if (request.audioIndices.some((index) => !source.streams.some((stream) => stream.type === "audio" && stream.index === index)))
         throw new Error("Audio track not found.");
      return sourceSession.prepare(source.id, request.audioIndices, request.transcode);
   });
   handle("preview:cancel", () => {
      sourceSession.cancelPreview();
   });
   handle("export:plan", async (value) => {
      const request = value;
      const result = await exportsService.plan(getSource(request.sourceId), request);
      recordAssessment(request.sourceId, result.items);
      return result;
   });
   handle("export:check-destinations", (value) => {
      const request = value;
      return exportsService.checkDestinations(getSource(request.sourceId), request);
   });
   handle("export:analyze", async (value) => {
      const request = value;
      const result = await exportsService.inspect(getSource(request.sourceId), request);
      recordAssessment(request.sourceId, result);
      return result;
   });
   handle("export:start", (value) => {
      const request = value;
      return exportsService.start(request.id, request.approval);
   });
   handle("export:cancel", () => exportsService.cancel());
   handle("export:retry", (value) => exportsService.retry(value));
   handle("output:open", async (value) => {
      const path = value;
      if (!exportsService.current?.items.some((item) => item.outputPath === path && item.status === "completed")) throw new Error("Exported file not found.");
      const failure = await shell.openPath(path);
      if (failure) throw new Error(failure);
   });
   handle("output:reveal", async (value) => {
      const path = value;
      if (frameOutputs.has(path) || updates.downloadedPath === path) {
         shell.showItemInFolder(path);
         return;
      }
      const job = exportsService.current;
      if (!job || !job.items.some((item) => item.outputPath === path && item.status === "completed")) throw new Error("Output not found.");
      shell.showItemInFolder(path);
   });
   // The renderer only ever opens links to project-owned sites; the allowlist keeps a
   // compromised page from reaching shell.openExternal with arbitrary targets.
   const externalHosts = new Set(["github.com", "noomstuff.com"]);
   handle("open:external", (value) => {
      const url = new URL(value);
      if (url.protocol !== "https:" || !externalHosts.has(url.hostname)) throw new Error("That link cannot be opened.");
      return shell.openExternal(url.href);
   });
   handle("notices:open", async () => {
      const path = isPackagedApp() ? join(process.resourcesPath, "THIRD_PARTY_NOTICES.md") : resolve(currentDirectory, "../../THIRD_PARTY_NOTICES.md");
      if (!existsSync(path)) throw new Error("The third-party notices file is missing from this installation.");
      const failure = await shell.openPath(path);
      if (failure) throw new Error(failure);
   });
   handle("diagnostics:export", async () => {
      const initialSource = sourceSession.current;
      const result = await dialog.showSaveDialog(window, {
         title: "Save diagnostics",
         defaultPath: join(app.getPath("downloads"), "AttaCut-diagnostics.json"),
         filters: [{ name: "Diagnostic report", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return false;
      const destination = result.filePath;
      const protectedSources = new Set([initialSource, sourceSession.current]);
      await protectDiagnosticDestination(destination, protectedSources);
      const tools = Object.fromEntries(
         await Promise.all(
            (["ffmpeg", "ffprobe"] as const).map(
               async (tool) =>
                  [
                     tool,
                     await runMedia(tool, ["-version"], { priority: "background" }).then(
                        (text) => text.split(/\r?\n/)[0]!,
                        () => "Unavailable"
                     ),
                  ] as const
            )
         )
      );
      const report = diagnosticReport(app.getVersion(), tools, sourceSession.current, exportsService.current);
      await withTemporaryOutput(dirname(destination), ".attacut-diagnostics-", async (directory) => {
         const temporary = join(directory, "report.json");
         await writeFile(temporary, JSON.stringify(report, null, 2));
         protectedSources.add(sourceSession.current);
         await protectDiagnosticDestination(destination, protectedSources);
         await publishOutput(temporary, destination, true);
      });
      return true;
   });
}
